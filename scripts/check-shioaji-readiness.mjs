import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { buildShioajiReadiness } from '../src/shioaji-readiness.mjs';

function inspectPython(command, args = []) {
  const probe = spawnSync(command, [
    ...args,
    '-c',
    [
      'import importlib.util, json, sys',
      'spec = importlib.util.find_spec("shioaji")',
      'version = None',
      'if spec:',
      '    import shioaji',
      '    version = getattr(shioaji, "__version__", None)',
      'print(json.dumps({"python": sys.version.split()[0], "installed": bool(spec), "version": version}))',
    ].join('\n'),
  ], { encoding: 'utf8', windowsHide: true });

  if (probe.status !== 0) return null;
  try {
    return JSON.parse(probe.stdout.trim());
  } catch {
    return null;
  }
}

function checkLocalPort(host = '127.0.0.1', port = 8080, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

const python = inspectPython('python') || inspectPython('py', ['-3']);
const serverReachable = await checkLocalPort();
const projectHasApiKey = Boolean(process.env.SJ_API_KEY);
const projectHasSecretKey = Boolean(process.env.SJ_SEC_KEY);
const futuresAccount = process.env.SJ_FUTURES_ACCOUNT_CONFIRMED === '1';
const futuresApiSigned = process.env.SJ_FUTURES_API_SIGNED === '1';

const readiness = buildShioajiReadiness({
  pythonAvailable: Boolean(python),
  packageInstalled: Boolean(python?.installed),
  serverReachable,
  projectHasApiKey,
  projectHasSecretKey,
  futuresAccount,
  futuresApiSigned,
});

const yesNo = (value) => (value ? '是' : '否');
console.log('Shioaji 唯讀行情接線檢查');
console.log(`Python：${python ? `${python.python}（可用）` : '找不到'}`);
console.log(`Shioaji：${python?.installed ? `${python.version || '已安裝'}` : '尚未安裝'}`);
console.log(`本機行情服務 127.0.0.1:8080：${serverReachable ? '可連線' : '尚未啟動'}`);
console.log(`期貨戶已確認：${yesNo(futuresAccount)}`);
console.log(`期貨 API 已簽署：${yesNo(futuresApiSigned)}`);
console.log(`券商秘密與面板隔離：${yesNo(readiness.secretsIsolatedFromDashboard)}`);
console.log(`可開始本機行情測試：${yesNo(readiness.readyForLocalMarketDataTest)}`);
console.log(`可開始 TX/TXO 研究收集：${yesNo(readiness.readyForTxResearch)}`);
console.log('實單權限：否');
if (readiness.blockers.length) console.log(`尚待完成：${readiness.blockers.join(', ')}`);

