export function chartTrust(data) {
  return { state: data.qualityStatus || 'UNAVAILABLE', eligibility: data.status || 'UNAVAILABLE',
    reasons: [data.reason,...(data.qualityReasons||[])].filter(Boolean) };
}
export function taipeiChartTime(value) {
  if(!Number.isFinite(value)) return '未知';
  return new Date(value*1000).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
}
export function sameChartSelection(left,right) {
  return left!=null&&left===right;
}
