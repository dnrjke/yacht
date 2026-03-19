Write-Host "Starting Yacht Game Monorepo..." -ForegroundColor Cyan

# 🔧 자동 포트 정리 로직 (npx kill-port 기법)
Write-Host "Cleaning up existing ghost processes on port 3001 (Backend) and 5173 (Frontend)..." -ForegroundColor Gray
npx --yes kill-port 3001 5173
Start-Sleep -Seconds 1

Write-Host "[0/2] Building Core Package..." -ForegroundColor Yellow
Push-Location core
npm run build
Pop-Location

# 🖥️ 터미널 실행 로직 (wt.exe 여부에 따른 폴백)
if (Get-Command wt.exe -ErrorAction SilentlyContinue) {
    Write-Host "Launching Windows Terminal with Backend and Frontend..." -ForegroundColor Yellow
    # Using Windows Terminal (wt.exe) to open a split pane view
    Start-Process "wt.exe" -ArgumentList "-d .\backend powershell.exe -NoExit -Command `"npm run dev`" `; split-pane -v -d .\frontend powershell.exe -NoExit -Command `"npm run dev`""
    Write-Host "Done! Windows Terminal is starting up." -ForegroundColor Green
} else {
    Write-Host "Windows Terminal not found. Falling back to dual PowerShell windows..." -ForegroundColor Yellow
    Start-Process "powershell.exe" -ArgumentList "-NoExit -Command cd backend; npm run dev"
    Start-Process "powershell.exe" -ArgumentList "-NoExit -Command cd frontend; npm run dev"
    Write-Host "Done! Both servers are starting up in separate windows." -ForegroundColor Green
}
