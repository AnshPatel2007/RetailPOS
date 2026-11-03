$ErrorActionPreference = 'Stop'
$lotteryDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../.local/lottery-workbooks')).Path
$lotteryExcel = $null
$lotteryResults = @()
try {
  $lotteryExcel = New-Object -ComObject Excel.Application
  $lotteryExcel.Visible = $false
  $lotteryExcel.DisplayAlerts = $false
  $lotteryExcel.AutomationSecurity = 3
  foreach ($name in @('lottery', 'lottery-machine')) {
    $file = Join-Path $lotteryDirectory ($name + '.xlsx')
    $statement = Get-Content -LiteralPath (Join-Path $lotteryDirectory ($name + '.json')) -Raw | ConvertFrom-Json
    $workbook = $lotteryExcel.Workbooks.Open($file, 0, $true)
    try {
      $lotteryExcel.CalculateFullRebuild()
      $sheet = $workbook.Worksheets.Item($statement.workbook.months[0].month)
      $values = @{}
      for ($row = 1; $row -le $sheet.UsedRange.Rows.Count; $row++) {
        $label = $sheet.Cells.Item($row, 10).Value2
        if ($label -in @('Confirmed lottery earnings', 'Total other income', 'Net income', 'Cost of goods sold', 'Net sales excluding tax')) { $values[$label] = $sheet.Cells.Item($row, 13).Value2 }
        for ($column = 1; $column -le 13; $column++) {
          if ($sheet.Cells.Item($row, $column).Text -match '^#(REF!|VALUE!|DIV/0!|NAME\?|N/A|NUM!|SPILL!)$') { throw "Excel formula error in $name at $row,$column" }
        }
      }
      foreach ($label in @('Confirmed lottery earnings', 'Total other income', 'Net income')) {
        if ([Math]::Abs([double]$values[$label] - [double]$statement.netIncome) -gt 0.001) { throw "Lottery income mismatch: $name / $label" }
      }
      if ([double]$values['Cost of goods sold'] -ne 0 -or [double]$values['Net sales excluding tax'] -ne 0) { throw 'Lottery face values entered merchandise figures' }
      $lotteryResults += [pscustomobject]@{ fixture = $name; values = $values; recalculated = $true }
    } finally { $workbook.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
  }
  $lotteryResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $lotteryDirectory 'excel-verification.json')
  Write-Output 'Excel recalculated both lottery fixtures; income, sales, COGS and formulas match.'
} finally {
  if ($null -ne $lotteryExcel) { $lotteryExcel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($lotteryExcel) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
