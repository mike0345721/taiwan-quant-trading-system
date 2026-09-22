"""Synthetic clock, actual LiveEventLedger writer. Isolated acceptance only."""
import datetime
import json
import pathlib
import sys
import time

repo = pathlib.Path(__file__).resolve().parents[2]
root = pathlib.Path(sys.argv[1]).resolve()
if not root.is_relative_to(repo / 'data' / 'cru55-prefix-acceptance') or not (root / 'fixture-authorized').is_file():
    raise RuntimeError('ISOLATED_FIXTURE_REQUIRED')
sys.path.insert(0, str(repo / 'broker'))
import live_event_ledger as module

origin = datetime.datetime.fromisoformat('2026-09-14T15:00:00+08:00')
count = 0
class Clock:
    @staticmethod
    def now():
        return origin + datetime.timedelta(seconds=count * 10)
    fromisoformat = staticmethod(datetime.datetime.fromisoformat)
module.datetime = Clock
ledger = module.LiveEventLedger(root / 'source')
log = open(root / 'writer-metrics.jsonl', 'a', encoding='utf8', buffering=1)
try:
    while not (root / 'stop-writer').exists():
        at = Clock.now().isoformat()
        start = time.perf_counter()
        row = ledger.append('futures_tick', {'code':'TXFI6', 'actualContract':'TXFI6',
            '_product_family':'TX', '_target_code':'TXFI6', 'datetime':at,
            'close':20000+count%11,'volume':1,'tick_type':1})
        count += 1
        metric = {'ordinal':count,'sourceWrittenAtMs':time.time()*1000,'writeMs':(time.perf_counter()-start)*1000,'recordHash':row['recordHash']}
        log.write(json.dumps(metric)+'\n')
        if count == 1100:
            print(json.dumps({'ready':True,'sourcePath':str(ledger.current_file),'count':count}),flush=True)
        if count >= 1100:
            time.sleep(0.1)
finally:
    log.close()
    print(json.dumps({'stopped':True,'count':count}),flush=True)
