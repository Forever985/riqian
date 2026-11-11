@echo off
REM ===================================================================
REM 日签安卓版 · 一键出包（Release，可直接装手机）
REM
REM 为什么要有这个脚本：环境全在 E 盘（zip 版 SDK + 独立 Android SDK），
REM 每次手敲一堆 -p: 参数太容易漏，而漏了只会看到「找不到 Android SDK 目录」，
REM 看不出是哪个参数少了。
REM
REM 用法：
REM   tools\build-android.cmd          出 Release 包（默认）
REM   tools\build-android.cmd debug    只编 Debug（快，但要刷 adb 才能跑）
REM
REM 产物：android\bin\Release\net8.0-android\publish\com.riqian.journal-Signed.apk
REM ===================================================================
setlocal

set DOTNET_ROOT=E:\AndroidDev\dotnet
set JAVA_HOME=C:\Program Files\Java\jdk-17
set ANDROID_HOME=E:\AndroidDev\android-sdk
set ANDROID_SDK_ROOT=E:\AndroidDev\android-sdk
set PATH=%DOTNET_ROOT%;%PATH%

set SDKARG=-p:AndroidSdkDirectory=E:\AndroidDev\android-sdk
set JDKARG=-p:JavaSdkDirectory=C:\Program Files\Java\jdk-17

REM 签名密钥放在仓库外面（E 盘），不进 git。
REM 这个密钥丢了就没法给已装的手机做升级 —— 只能卸载重装（数据在外部目录，不会丢）。
set KS=E:\AndroidDev\riqian-release.keystore
set KSALIAS=riqian
set KSPASS=riqian2026

cd /d "%~dp0..\android"
if not exist "..\wwwroot\index.html" (
  echo [错误] 找不到 wwwroot\index.html
  echo        先在 web 目录跑 npm run build —— 安卓和桌面用的是同一份界面产物。
  exit /b 1
)

if /i "%1"=="debug" goto dbg

REM ---------- Release ----------
if not exist "%KS%" (
  echo [错误] 找不到签名密钥 %KS%
  echo        生成方法：
  echo          "C:\Program Files\Java\jdk-17\bin\keytool.exe" -genkeypair -keystore %KS% -alias %KSALIAS% -keyalg RSA -keysize 2048 -validity 10000 -storepass %KSPASS% -keypass %KSPASS% -dname "CN=Riqian, OU=Personal, O=Riqian Diary, L=Local, ST=Local, C=CN"
  exit /b 1
)

echo [Release] 开始出包...
"%DOTNET_ROOT%\dotnet.exe" publish -c Release -f net8.0-android --nologo "%SDKARG%" "%JDKARG%" ^
  -p:AndroidKeyStore=true ^
  -p:AndroidSigningKeyStore=%KS% ^
  -p:AndroidSigningKeyAlias=%KSALIAS% ^
  -p:AndroidSigningKeyPass=%KSPASS% ^
  -p:AndroidSigningStorePass=%KSPASS% ^
  -p:AndroidPackageFormats=apk ^
  -p:PublishTrimmed=false ^
  -p:RunAOTCompilation=false
if errorlevel 1 goto fail

echo.
echo 产物：
dir /b "bin\Release\net8.0-android\publish\*-Signed.apk"
for %%F in ("bin\Release\net8.0-android\publish\*-Signed.apk") do echo    %%~fF  (%%~zF 字节)
goto done

 REM ---------- Debug ----------
:dbg
echo [Debug] 开始编译（快速部署：程序集不进 APK，要用 adb 装）...
"%DOTNET_ROOT%\dotnet.exe" build -c Debug -f net8.0-android --nologo "%SDKARG%" "%JDKARG%"
if errorlevel 1 goto fail
echo.
echo 产物：
dir /b "bin\Debug\net8.0-android\*-Signed.apk"
goto done

:fail
echo.
echo [失败] 构建没通过，看上面的错误。
exit /b 1

:done
endlocal
