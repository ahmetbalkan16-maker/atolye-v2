$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ayas-access-daemon.ps1') -LibraryOnly
$taskTemp=Join-Path $env:TEMP ('ayas-published-root-'+[guid]::NewGuid().ToString('N'))
$taskCanonical=Join-Path $taskTemp 'canonical'
$taskRelease=Join-Path $taskTemp 'published Atölye'
New-Item -ItemType Directory -Path $taskCanonical,(Join-Path $taskRelease 'node_modules\next\dist\bin') -Force | Out-Null
$taskCli=Join-Path $taskRelease 'node_modules\next\dist\bin\next'
$taskFake=@"
const http=require('node:http');
const fs=require('node:fs');
fs.writeFileSync('cwd-record.json',JSON.stringify({cwd:process.cwd(),directory:process.argv[3]}));
http.createServer((req,res)=>{res.writeHead(307,{'x-ayas-access-gate':'enforced',location:'/login?next='+encodeURIComponent(req.url)});res.end();}).listen(Number(process.argv[process.argv.indexOf('-p')+1]),'127.0.0.1');
"@
[IO.File]::WriteAllText($taskCli,$taskFake,[Text.UTF8Encoding]::new($false))
$script:RepoRoot=$taskCanonical; $script:PublishedApplicationRoot=$taskRelease
$script:AppLog=Join-Path $taskTemp 'stdout'; $script:AppErrLog=Join-Path $taskTemp 'stderr'
$script:AppWrapperPidFile=Join-Path $taskTemp 'wrapper.pid'; $script:AppListenerPidFile=Join-Path $taskTemp 'listener.pid'
$taskAllocator=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0); $taskAllocator.Start(); $script:Port=$taskAllocator.LocalEndpoint.Port; $taskAllocator.Stop()
function Test-PrebuiltRuntime { $true }
$taskOutcome=$null
try {
 $taskOutcome=Start-Origin
 if(-not $taskOutcome.ok){throw ('START_FAILED_'+$taskOutcome.stage)}
 $taskRecord=Get-Content (Join-Path $taskCanonical 'cwd-record.json') -Raw -Encoding UTF8|ConvertFrom-Json
 if($taskRecord.cwd -ne $taskCanonical -or $taskRecord.directory -ne $taskRelease){throw 'CWD_OR_DIRECTORY_CHANGED'}
 $taskProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($taskOutcome.wrapperPid)"
 if(-not(Test-ExpectedOrigin $taskProcess)){throw 'PUBLISHED_IDENTITY_REJECTED'}
 $taskWrong=[pscustomobject]@{Name=$taskProcess.Name;ExecutablePath=$taskProcess.ExecutablePath;CommandLine=$taskProcess.CommandLine}; $taskWrong.CommandLine=$taskWrong.CommandLine.Replace(('start "'+$taskRelease+'"'),('start "'+$taskCanonical+'"'))
 if(Test-ExpectedOrigin $taskWrong){throw 'OTHER_DIRECTORY_ACCEPTED'}
 $taskWrong=[pscustomobject]@{Name=$taskProcess.Name;ExecutablePath=$taskProcess.ExecutablePath;CommandLine=$taskProcess.CommandLine}; $taskWrong.CommandLine=$taskWrong.CommandLine.Replace(('"'+$taskCli+'"'),('"'+(Join-Path $taskCanonical 'node_modules\next\dist\bin\next')+'"'))
 if(Test-ExpectedOrigin $taskWrong){throw 'DEVELOPMENT_CLI_ACCEPTED'}
 if((Start-Origin).stage -ne 'origin-race'){throw 'DUPLICATE_LAUNCH_ALLOWED'}
 'PUBLISHED_ROOT_NATIVE_PASS: canonical cwd, exact application directory, wrong-dir refusal, wrong-cli refusal, singleton'
} finally {
 if($taskOutcome -and $taskOutcome.wrapperPid){$taskOwned=Get-CimInstance Win32_Process -Filter "ProcessId=$($taskOutcome.wrapperPid)" -ErrorAction SilentlyContinue; if($taskOwned -and $taskOwned.CommandLine.Contains($taskCli)){Stop-Process -Id $taskOutcome.wrapperPid}}
}