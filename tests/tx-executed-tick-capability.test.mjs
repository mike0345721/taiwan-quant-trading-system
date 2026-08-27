import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildTxDecisionChart } from '../src/dashboard-tx-chart.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));

function runBridgeFixture(root) {
  const script = String.raw`
import json, queue, sys, threading, time as time_module, types
from datetime import datetime, timedelta, timezone
from pathlib import Path

class QuoteType:
    Tick = "Tick"
    BidAsk = "BidAsk"

sys.modules["shioaji"] = types.SimpleNamespace(QuoteType=QuoteType)
sys.path.insert(0, str(Path.cwd() / "broker"))
import shioaji_readonly_bridge as bridge
from live_event_ledger import LiveEventLedger

target = Path(sys.argv[1]) / "live-events"
bridge.EVENT_LEDGER = LiveEventLedger(target)
bridge.EVENT_QUEUE = queue.Queue(maxsize=100)
bridge.FUTURES_METADATA.clear()
bridge.FUTURES_METADATA["TXFI6"] = {
    "productFamily": "TX", "subscriptionAlias": "TXFR1", "targetCode": "TXFI6"
}
writer = threading.Thread(target=bridge.event_writer)
writer.start()

class FakeTick:
    def __init__(self, timestamp, price, volume):
        self.timestamp, self.price, self.volume = timestamp, price, volume
    def to_dict(self, raw=True):
        assert raw is True
        return {
            "code": "TXFI6", "datetime": self.timestamp, "close": self.price,
            "volume": self.volume, "total_volume": 1000 + self.volume,
            "simtrade": False, "tick_type": 1,
        }

bridge.record("futures_tick", FakeTick("2026-08-26T09:01:02+08:00", 22100, 2))
bridge.EVENT_QUEUE.join()
ledger = next(target.glob("*.ndjson"))
first_bytes = ledger.read_bytes()
bridge.record("futures_tick", FakeTick("2026-08-26T09:01:40+08:00", 22101, 3))
bridge.EVENT_QUEUE.join()
all_bytes = ledger.read_bytes()
bridge.EVENT_QUEUE.put(None)
writer.join(timeout=5)
last_delivery_before_rejected = bridge.REQUIRED_SUBSCRIPTIONS["TX"]["quoteTypeHealth"]["Tick"]["lastObservedAt"]
bridge.record("futures_tick", FakeTick(None, None, None))
callback_errors_after_malformed = bridge.QUEUE_STATE["callbackErrors"]
bridge.EVENT_QUEUE = queue.Queue(maxsize=1)
bridge.EVENT_QUEUE.put(("occupied", {}))
bridge.record("futures_tick", FakeTick("2026-08-26T09:02:00+08:00", 22102, 1))
delivery_after_rejected = bridge.REQUIRED_SUBSCRIPTIONS["TX"]["quoteTypeHealth"]["Tick"]["lastObservedAt"]
ledger_unchanged_after_rejected = ledger.read_bytes() == all_bytes
records = [json.loads(line) for line in all_bytes.decode("utf-8").splitlines()]

now = datetime.now().astimezone()
health = bridge.REQUIRED_SUBSCRIPTIONS["TX"]["quoteTypeHealth"]
for quote_type in ("Tick", "BidAsk"):
    health[quote_type].update({
        "subscriptionState": "RESTORED", "subscribedAt": (now - timedelta(seconds=31)).isoformat(),
        "lastObservedAt": None, "deliveryState": "PENDING", "resubscribeAttempts": 0,
        "lastResubscribeAt": None,
    })
silent_snapshot = next(item for item in bridge.quote_delivery_snapshot(now, True) if item["product"] == "TX")
health["BidAsk"].update({"lastObservedAt": now.isoformat(), "deliveryState": "LIVE"})
delivery_snapshot = next(item for item in bridge.quote_delivery_snapshot(now, True) if item["product"] == "TX")
class FakeApi:
    def __init__(self): self.calls = []
    def subscribe(self, contract, quote_type): self.calls.append([contract, quote_type])
api = FakeApi()
bridge.record_lifecycle = lambda *args, **kwargs: None
retry_count = bridge.recover_missing_quote_types(api, {"TX": "TXFI6"}, now, True)
tick_recovery = dict(bridge.REQUIRED_SUBSCRIPTIONS["TX"]["quoteTypeHealth"]["Tick"])
reconnect_api = FakeApi()
bridge.resubscribe_futures_after_reconnect(reconnect_api, {"TX": "TXFI6"})
post_reconnect_budget = dict(health["Tick"])
health["Tick"].update({"resubscribeAttempts": 3, "lastResubscribeAt": now.isoformat(), "recoveryState": "EXHAUSTED"})
generation_api = FakeApi()
exhausted_generation = bridge.note_provider_reconnecting()
exhausted_generation_scheduled = bridge.schedule_futures_resubscribe_after_reconnect(
    generation_api, {"TX": "TXFI6"}, exhausted_generation
)
deadline = time_module.monotonic() + 2
while len(generation_api.calls) < 2 and time_module.monotonic() < deadline:
    time_module.sleep(0.01)
generation_reset = dict(health["Tick"])
health["Tick"].update({
    "subscriptionState": "RESTORED", "subscribedAt": (now - timedelta(seconds=31)).isoformat(),
    "lastObservedAt": None, "deliveryState": "PENDING",
})
health["BidAsk"].update({"lastObservedAt": now.isoformat(), "deliveryState": "LIVE"})
post_generation_retry_api = FakeApi()
post_generation_retry_count = bridge.recover_missing_quote_types(
    post_generation_retry_api, {"TX": "TXFI6"}, now, True
)
coalesced_api = FakeApi()
first_generation = bridge.note_provider_reconnecting()
coalesced = [
    bridge.schedule_futures_resubscribe_after_reconnect(coalesced_api, {"TX": "TXFI6"}, first_generation),
    bridge.schedule_futures_resubscribe_after_reconnect(coalesced_api, {"TX": "TXFI6"}, first_generation),
]
deadline = time_module.monotonic() + 2
while len(coalesced_api.calls) < 2 and time_module.monotonic() < deadline:
    time_module.sleep(0.01)
second_generation = bridge.note_provider_reconnecting()
coalesced.append(bridge.schedule_futures_resubscribe_after_reconnect(
    coalesced_api, {"TX": "TXFI6"}, second_generation
))
deadline = time_module.monotonic() + 2
while len(coalesced_api.calls) < 4 and time_module.monotonic() < deadline:
    time_module.sleep(0.01)
stale_at = (now - timedelta(minutes=10)).isoformat()
for quote_type in ("Tick", "BidAsk"):
    health[quote_type].update({
        "subscriptionState": "RESTORED", "lastObservedAt": stale_at,
        "deliveryState": "LIVE", "freshnessState": "LIVE",
    })
stale_snapshot = next(item for item in bridge.quote_delivery_snapshot(now, True) if item["product"] == "TX")
closed_snapshot = next(item for item in bridge.quote_delivery_snapshot(now, False) if item["product"] == "TX")
closed_api = FakeApi()
closed_retry_count = bridge.recover_missing_quote_types(closed_api, {"TX": "TXFI6"}, now, False)

class BlockingApi:
    def __init__(self):
        self.calls, self.active, self.max_active = [], 0, 0
        self.lock = threading.Lock()
    def subscribe(self, contract, quote_type):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time_module.sleep(0.02)
        self.calls.append([contract, quote_type])
        with self.lock: self.active -= 1
for quote_type in ("Tick", "BidAsk"):
    health[quote_type].update({
        "subscriptionState": "RESTORED", "subscribedAt": (now - timedelta(seconds=31)).isoformat(),
        "lastObservedAt": None, "deliveryState": "PENDING", "resubscribeAttempts": 0,
        "lastResubscribeAt": None,
    })
health["BidAsk"].update({"lastObservedAt": now.isoformat(), "deliveryState": "LIVE"})
blocking_api = BlockingApi()
recover_thread = threading.Thread(target=bridge.recover_missing_quote_types, args=(blocking_api, {"TX": "TXFI6"}, now, True))
reconnect_thread = threading.Thread(target=bridge.resubscribe_futures_after_reconnect, args=(blocking_api, {"TX": "TXFI6"}))
recover_thread.start(); reconnect_thread.start()
recover_thread.join(timeout=2); reconnect_thread.join(timeout=2)

print(json.dumps({
    "records": records,
    "historyPreserved": all_bytes.startswith(first_bytes),
    "callbackErrorsAfterMalformed": callback_errors_after_malformed,
    "droppedAfterFull": bridge.QUEUE_STATE["dropped"],
    "deliveryUnchangedAfterRejected": delivery_after_rejected == last_delivery_before_rejected,
    "ledgerUnchangedAfterRejected": ledger_unchanged_after_rejected,
    "writerHealthAfterRejected": bridge.writer_health_state(
        {**bridge.QUEUE_STATE, "writerThreadAlive": True}, {"lowDisk": False}
    ),
    "retryCount": retry_count,
    "retryCalls": api.calls,
    "tickRecovery": tick_recovery,
    "silentSnapshot": silent_snapshot,
    "reconnectCalls": reconnect_api.calls,
    "postReconnectBudget": post_reconnect_budget,
    "generationReset": generation_reset,
    "exhaustedGenerationScheduled": exhausted_generation_scheduled,
    "generationCalls": generation_api.calls,
    "postGenerationRetryCount": post_generation_retry_count,
    "postGenerationRetryCalls": post_generation_retry_api.calls,
    "coalesced": coalesced,
    "coalescedCalls": coalesced_api.calls,
    "deliverySnapshot": delivery_snapshot,
    "staleSnapshot": stale_snapshot,
    "closedSnapshot": closed_snapshot,
    "closedRetryCount": closed_retry_count,
    "closedRetryCalls": closed_api.calls,
    "maxConcurrentSubscribe": blocking_api.max_active,
}))
`;
  const result = spawnSync(process.env.DW4_PYTHON || 'python', ['-c', script, root], {
    cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

test('representative FOP Tick callback reaches normalized append-only ledger and governed 1m/5m bars', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-executed-tick-'));
  try {
    const output = runBridgeFixture(root);
    assert.equal(output.historyPreserved, true);
    assert.equal(output.callbackErrorsAfterMalformed, 1);
    assert.equal(output.droppedAfterFull, 1);
    assert.equal(output.deliveryUnchangedAfterRejected, true);
    assert.equal(output.ledgerUnchangedAfterRejected, true);
    assert.equal(output.writerHealthAfterRejected, 'FAIL');
    assert.equal(output.records.length, 2);
    const [first] = output.records;
    assert.equal(first.kind, 'futures_tick');
    assert.equal(first.payload.eventTime, '2026-08-26T09:01:02+08:00');
    assert.equal(first.payload.price, 22100);
    assert.equal(first.payload.executedVolume, 2);
    assert.equal(first.payload.productFamily, 'TX');
    assert.equal(first.payload.subscriptionAlias, 'TXFR1');
    assert.equal(first.payload.targetCode, 'TXFI6');
    assert.equal(first.payload.actualContract, 'TXFI6');
    assert.equal(first.payload.simtrade, false);
    assert.equal(first.formalWeight, 0);
    assert.equal(first.researchOnly, true);
    assert.equal(first.executionAuthorized, false);
    assert.equal(first.orderRoutesEnabled, false);

    const asOf = new Date(Math.max(...output.records.map((record) => Date.parse(record.receivedAt))) + 60_000).toISOString();
    for (const timeframe of ['1m', '5m']) {
      const chart = buildTxDecisionChart(output.records, {
        calendar, timeframe, tradeDate: '2026-08-26', session: 'DAY', mode: 'REPLAY',
        asOf,
      });
      assert.equal(chart.status, 'READY');
      assert.equal(chart.sourceEventCount, 2);
      assert.equal(chart.bars.length, 1);
      assert.equal(chart.bars[0].volume, 5);
      assert.equal(chart.executionAuthorized, false);
      assert.equal(chart.orderRoutesEnabled, false);
    }

    const bidAskOnlyChart = buildTxDecisionChart([{ ...first, kind: 'futures_bidask' }], {
      calendar, timeframe: '5m', tradeDate: '2026-08-26', session: 'DAY', mode: 'REPLAY',
      asOf,
    });
    assert.equal(bidAskOnlyChart.status, 'UNAVAILABLE');
    assert.equal(bidAskOnlyChart.sourceEventCount, 0);
    assert.deepEqual(bidAskOnlyChart.bars, []);

    assert.equal(output.retryCount, 1);
    assert.equal(output.deliverySnapshot.state, 'PARTIAL');
    assert.equal(output.deliverySnapshot.quoteTypeHealth.Tick.deliveryState, 'MISSING');
    assert.equal(output.deliverySnapshot.quoteTypeHealth.BidAsk.deliveryState, 'LIVE');
    assert.equal(output.silentSnapshot.state, 'PARTIAL');
    assert.equal(output.silentSnapshot.quoteTypeHealth.Tick.deliveryState, 'MISSING');
    assert.equal(output.silentSnapshot.quoteTypeHealth.BidAsk.deliveryState, 'MISSING');
    assert.deepEqual(output.retryCalls, [['TXFI6', 'Tick']]);
    assert.equal(output.tickRecovery.resubscribeAttempts, 1);
    assert.equal(output.tickRecovery.recoveryState, 'WAITING_FOR_DELIVERY');
    assert.equal(output.tickRecovery.lastObservedAt, null);
    assert.deepEqual(output.reconnectCalls, [['TXFI6', 'Tick'], ['TXFI6', 'BidAsk']]);
    assert.equal(output.postReconnectBudget.resubscribeAttempts, 0);
    assert.equal(output.postReconnectBudget.lastResubscribeAt, null);
    assert.equal(output.generationReset.resubscribeAttempts, 0);
    assert.equal(output.generationReset.lastResubscribeAt, null);
    assert.equal(output.exhaustedGenerationScheduled, true);
    assert.deepEqual(output.generationCalls, [['TXFI6', 'Tick'], ['TXFI6', 'BidAsk']]);
    assert.equal(output.postGenerationRetryCount, 1);
    assert.deepEqual(output.postGenerationRetryCalls, [['TXFI6', 'Tick']]);
    assert.deepEqual(output.coalesced, [true, false, true]);
    assert.deepEqual(output.coalescedCalls, [
      ['TXFI6', 'Tick'], ['TXFI6', 'BidAsk'], ['TXFI6', 'Tick'], ['TXFI6', 'BidAsk'],
    ]);
    assert.equal(output.staleSnapshot.state, 'PARTIAL');
    assert.equal(output.staleSnapshot.quoteTypeHealth.Tick.deliveryState, 'STALE');
    assert.equal(output.staleSnapshot.quoteTypeHealth.BidAsk.deliveryState, 'STALE');
    assert.equal(output.closedSnapshot.state, 'RESTORED');
    assert.equal(output.closedSnapshot.quoteTypeHealth.Tick.deliveryState, 'LIVE');
    assert.equal(output.closedSnapshot.quoteTypeHealth.Tick.freshnessState, 'SESSION_CLOSED');
    assert.equal(output.closedRetryCount, 0);
    assert.deepEqual(output.closedRetryCalls, []);
    assert.equal(output.maxConcurrentSubscribe, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
