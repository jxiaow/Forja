#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601
#include <windows.h>

#include <map>
#include <string>
#include <vector>

namespace {

std::wstring Utf8ToWide(const std::string& value) {
    if (value.empty()) { return {}; }
    const int length = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (length <= 0) { return {}; }
    std::wstring result(static_cast<size_t>(length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length);
    return result;
}

std::wstring ModulePath() {
    std::wstring result(32768, L'\0');
    const DWORD length = GetModuleFileNameW(nullptr, result.data(), static_cast<DWORD>(result.size()));
    if (length == 0 || length >= result.size()) { return {}; }
    result.resize(length);
    return result;
}

std::wstring SidecarPath(const std::wstring& modulePath, const wchar_t* suffix) {
    const size_t extension = modulePath.rfind(L'.');
    return (extension == std::wstring::npos ? modulePath : modulePath.substr(0, extension)) + suffix;
}

bool ReadAll(const std::wstring& filePath, std::string* content) {
    const HANDLE file = CreateFileW(filePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (file == INVALID_HANDLE_VALUE) { return false; }

    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || size.QuadPart > 1024 * 1024) {
        CloseHandle(file);
        return false;
    }

    const size_t expectedSize = static_cast<size_t>(size.QuadPart);
    content->resize(expectedSize);
    DWORD totalRead = 0;
    bool ok = true;
    while (totalRead < content->size()) {
        DWORD bytesRead = 0;
        ok = ReadFile(
            file,
            content->data() + totalRead,
            static_cast<DWORD>(content->size() - totalRead),
            &bytesRead,
            nullptr) != FALSE;
        if (!ok || bytesRead == 0) { break; }
        totalRead += bytesRead;
    }
    CloseHandle(file);
    if (!ok || totalRead != expectedSize) { return false; }
    content->resize(totalRead);
    return true;
}

bool ReadEnvironment(const std::wstring& filePath, std::vector<wchar_t>* environment) {
    std::string bytes;
    if (!ReadAll(filePath, &bytes) || bytes.size() < sizeof(wchar_t) * 2 || bytes.size() % sizeof(wchar_t) != 0) {
        return false;
    }
    environment->resize(bytes.size() / sizeof(wchar_t));
    CopyMemory(environment->data(), bytes.data(), bytes.size());
    return environment->size() >= 2
        && (*environment)[environment->size() - 1] == L'\0'
        && (*environment)[environment->size() - 2] == L'\0';
}

std::map<std::string, std::wstring> ParseRequest(const std::string& content) {
    std::map<std::string, std::wstring> result;
    size_t start = 0;
    while (start < content.size()) {
        const size_t end = content.find('\n', start);
        const std::string line = content.substr(start, end == std::string::npos ? std::string::npos : end - start);
        const size_t separator = line.find('=');
        if (separator != std::string::npos) {
            result[line.substr(0, separator)] = Utf8ToWide(line.substr(separator + 1));
        }
        if (end == std::string::npos) { break; }
        start = end + 1;
    }
    return result;
}

void WriteStatus(const std::wstring& statusPath, const std::string& text) {
    const std::wstring tempPath = statusPath + L".tmp";
    const HANDLE file = CreateFileW(tempPath.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, 0, nullptr);
    if (file == INVALID_HANDLE_VALUE) { return; }
    DWORD written = 0;
    WriteFile(file, text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
    FlushFileBuffers(file);
    CloseHandle(file);
    MoveFileExW(tempPath.c_str(), statusPath.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
}

void WriteError(const std::wstring& statusPath, const char* stage, DWORD error) {
    WriteStatus(statusPath, "stage=" + std::string(stage) + "\nerror=" + std::to_string(error) + "\n");
}

HANDLE OpenOutput(const std::wstring& outputPath, bool pipeOutput) {
    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.bInheritHandle = TRUE;

    if (!pipeOutput) {
        return CreateFileW(
            outputPath.c_str(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            &security,
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
    }

    for (int attempt = 0; attempt < 20; ++attempt) {
        const HANDLE pipe = CreateFileW(
            outputPath.c_str(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            &security,
            OPEN_EXISTING,
            0,
            nullptr);
        if (pipe != INVALID_HANDLE_VALUE) { return pipe; }
        if (GetLastError() != ERROR_PIPE_BUSY || !WaitNamedPipeW(outputPath.c_str(), 500)) { break; }
    }
    return INVALID_HANDLE_VALUE;
}

bool PrepareStartup(
    HANDLE stdinHandle,
    HANDLE stdoutHandle,
    HANDLE stderrHandle,
    STARTUPINFOEXW* startup,
    std::vector<unsigned char>* attributeStorage,
    std::vector<HANDLE>* inheritedHandles
) {
    startup->StartupInfo.cb = sizeof(*startup);
    startup->StartupInfo.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    startup->StartupInfo.wShowWindow = SW_HIDE;
    startup->StartupInfo.hStdInput = stdinHandle;
    startup->StartupInfo.hStdOutput = stdoutHandle;
    startup->StartupInfo.hStdError = stderrHandle;

    SIZE_T attributeSize = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeSize);
    if (attributeSize == 0) { return false; }
    attributeStorage->resize(attributeSize);
    startup->lpAttributeList = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(attributeStorage->data());
    if (!InitializeProcThreadAttributeList(startup->lpAttributeList, 1, 0, &attributeSize)) {
        startup->lpAttributeList = nullptr;
        return false;
    }

    *inheritedHandles = { stdinHandle, stdoutHandle };
    if (stderrHandle != stdoutHandle) { inheritedHandles->push_back(stderrHandle); }
    return UpdateProcThreadAttribute(
        startup->lpAttributeList,
        0,
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
        inheritedHandles->data(),
        inheritedHandles->size() * sizeof(HANDLE),
        nullptr,
        nullptr) != FALSE;
}

void MarkLauncherDone(const std::wstring& modulePath) {
    const std::wstring donePath = modulePath + L".done";
    const HANDLE done = CreateFileW(donePath.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, 0, nullptr);
    if (done != INVALID_HANDLE_VALUE) { CloseHandle(done); }
}

}  // namespace


int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    const std::wstring modulePath = ModulePath();
    if (modulePath.empty()) { return 2; }
    const std::wstring requestPath = SidecarPath(modulePath, L".request");

    std::string requestContent;
    if (!ReadAll(requestPath, &requestContent)) {
        WriteError(SidecarPath(modulePath, L".status"), "request-read", GetLastError());
        return 3;
    }
    DeleteFileW(requestPath.c_str());

    const auto request = ParseRequest(requestContent);
    const std::wstring target = request.count("target") ? request.at("target") : L"";
    const std::wstring cwd = request.count("cwd") ? request.at("cwd") : L"";
    const std::wstring stdoutPath = request.count("stdout") ? request.at("stdout") : L"";
    const std::wstring stderrPath = request.count("stderr") ? request.at("stderr") : L"";
    const std::wstring statusPath = request.count("status") ? request.at("status") : L"";
    const std::wstring environmentPath = request.count("environment") ? request.at("environment") : L"";
    const bool detached = request.count("detached") && request.at("detached") == L"1";
    const bool pipeOutput = request.count("outputMode") && request.at("outputMode") == L"pipe";

    if (target.empty() || cwd.empty() || stdoutPath.empty() || stderrPath.empty()
        || statusPath.empty() || environmentPath.empty()) {
        if (!statusPath.empty()) { WriteError(statusPath, "request", ERROR_INVALID_PARAMETER); }
        return 4;
    }

    std::vector<wchar_t> environment;
    if (!ReadEnvironment(environmentPath, &environment)) {
        WriteError(statusPath, "environment", ERROR_INVALID_DATA);
        DeleteFileW(environmentPath.c_str());
        return 5;
    }
    DeleteFileW(environmentPath.c_str());

    HANDLE stdoutHandle = OpenOutput(stdoutPath, pipeOutput);
    if (stdoutHandle == INVALID_HANDLE_VALUE) {
        WriteError(statusPath, "stdout", GetLastError());
        return 6;
    }

    HANDLE stderrHandle = stdoutPath == stderrPath ? stdoutHandle : OpenOutput(stderrPath, pipeOutput);
    if (stderrHandle == INVALID_HANDLE_VALUE) {
        const DWORD error = GetLastError();
        CloseHandle(stdoutHandle);
        WriteError(statusPath, "stderr", error);
        return 7;
    }

    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.bInheritHandle = TRUE;
    HANDLE stdinHandle = CreateFileW(
        L"NUL",
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        &security,
        OPEN_EXISTING,
        0,
        nullptr);
    if (stdinHandle == INVALID_HANDLE_VALUE) {
        const DWORD error = GetLastError();
        if (stderrHandle != stdoutHandle) { CloseHandle(stderrHandle); }
        CloseHandle(stdoutHandle);
        WriteError(statusPath, "stdin", error);
        return 8;
    }

    STARTUPINFOEXW startup{};
    std::vector<unsigned char> attributeStorage;
    std::vector<HANDLE> inheritedHandles;
    if (!PrepareStartup(stdinHandle, stdoutHandle, stderrHandle, &startup, &attributeStorage, &inheritedHandles)) {
        const DWORD error = GetLastError();
        if (startup.lpAttributeList) { DeleteProcThreadAttributeList(startup.lpAttributeList); }
        CloseHandle(stdinHandle);
        if (stderrHandle != stdoutHandle) { CloseHandle(stderrHandle); }
        CloseHandle(stdoutHandle);
        WriteError(statusPath, "handle-list", error);
        return 9;
    }

    std::wstring commandLine = L"\"" + target + L"\"";
    PROCESS_INFORMATION process{};
    const BOOL created = CreateProcessW(
        target.c_str(),
        commandLine.data(),
        nullptr,
        nullptr,
        TRUE,
        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
        environment.data(),
        cwd.c_str(),
        &startup.StartupInfo,
        &process);
    const DWORD createError = created ? ERROR_SUCCESS : GetLastError();

    DeleteProcThreadAttributeList(startup.lpAttributeList);
    CloseHandle(stdinHandle);
    if (stderrHandle != stdoutHandle) { CloseHandle(stderrHandle); }
    CloseHandle(stdoutHandle);

    if (!created) {
        WriteError(statusPath, "create-process", createError);
        MarkLauncherDone(modulePath);
        return 10;
    }

    const DWORD processId = process.dwProcessId;
    CloseHandle(process.hThread);
    WriteStatus(statusPath, "pid=" + std::to_string(processId) + "\n");
    WaitForSingleObject(process.hProcess, INFINITE);

    DWORD exitCode = 1;
    GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hProcess);
    if (detached) {
        DeleteFileW(statusPath.c_str());
    } else {
        WriteStatus(
            statusPath,
            "pid=" + std::to_string(processId)
                + "\nexit=" + std::to_string(exitCode) + "\n");
    }
    MarkLauncherDone(modulePath);
    return 0;
}
