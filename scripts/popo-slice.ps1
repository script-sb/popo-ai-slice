param(
  [string]$Keyword = "报价",
  [int]$PageSize = 10,
  [int]$Days = 1
)

$timeStart = [DateTimeOffset]::Now.AddDays(-1 * $Days).ToUnixTimeMilliseconds()
$timeEnd = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()

popo-cli popo message_search query="$Keyword" type=1 page=0 pageSize=$PageSize msgType=1 timeStart=$timeStart timeEnd=$timeEnd
