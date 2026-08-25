Start-Sleep -Seconds 90
$runs = Invoke-RestMethod -Uri "https://api.github.com/repos/sansej8989/td2tdr/actions/runs?per_page=2"
$runs.workflow_runs | ForEach-Object { Write-Output ("run: " + $_.head_branch + " | " + $_.status + " | " + $_.conclusion) }
try { $r = Invoke-RestMethod -Uri "https://api.github.com/repos/sansej8989/td2tdr/releases/tags/v0.0.501"; Write-Output ("RELEASE OK: " + $r.name); $r.assets | ForEach-Object { Write-Output ("asset: " + $_.name) } } catch { Write-Output "release not created yet" }
