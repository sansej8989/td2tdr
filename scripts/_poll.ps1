Start-Sleep -Seconds 110
$runs = Invoke-RestMethod -Uri "https://api.github.com/repos/sansej8989/td2tdr/actions/runs?per_page=1"
$r = $runs.workflow_runs[0]
Write-Output ("workflow: " + $r.status + " | " + $r.conclusion)
if ($r.conclusion -eq "success") {
  try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/sansej8989/td2tdr/releases/tags/v0.0.506"
    Write-Output ("RELEASE OK: " + $rel.html_url)
    $rel.assets | ForEach-Object { Write-Output ("asset: " + $_.name) }
  } catch { Write-Output "release not visible yet" }
}
