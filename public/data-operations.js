(function (root) {
  'use strict';
  const labels = { PASS: '完整', PARTIAL: '部分資料有缺口', UNKNOWN: '證據不足', PENDING: '等待資料', FAIL: '資料驗收未通過', NOT_EXPECTED: '本次不需收集' };
  const checkpoints = { DAY_CHECKPOINT: 'DAY 日盤', EOD_CHECKPOINT: 'EOD 盤後', FINAL_TRADEDATE_CHECKPOINT: 'FINAL 全交易日' };
  const escape = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const time = value => value ? escape(value.replace('T', ' ').replace('Z', ' UTC')) : '尚無紀錄';
  const taipeiTime = value => value ? escape(new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))) : '尚無紀錄';
  const schedulerLabels = { NOT_DUE: '尚未到時間', WAITING_FOR_RUN: '寬限內等待執行', ON_TIME_SUCCEEDED: '準時完成',
    LATE_SUCCEEDED: '補跑成功 ⚠', ACCEPTANCE_JOB_FAILED: '驗收工作失敗', OVERDUE_NO_RECEIPT: '逾時未見執行結果', UNKNOWN: '排程證據未知' };
  const pill = value => `<span class="dop-state" data-state="${escape(value)}">${escape(value)} · ${escape(labels[value] || '尚未驗證')}</span>`;
  const eligibilityLabels = { READY: '符合既有用途資格', READY_WITH_LIMITATION: '有限制，須依原因使用', NOT_READY: '不可用於既定研究', UNKNOWN: '資格未知', NOT_APPLICABLE: '不適用' };
  const measurement = value => value == null ? '未知／尚無量測' : escape(value);
  function renderBrief(b) {
    if (!b) return '';
    const current = b.assessmentScope === 'CURRENT_DAY_SNAPSHOT';
    const completion = { COMPLETE: '各階段工作完成', COMPLETE_WITH_LATE_RECOVERY: '含延遲補跑', INCOMPLETE: '尚未全數完成', NOT_APPLICABLE: '依日曆不需執行', UNKNOWN: '排程證據未知' };
    return `<section aria-label="每日資料健康摘要"><h3>每日資料健康摘要 · ${escape(b.tradeDate || '日期未知')}</h3>
      ${current ? `<p>以下是 ${escape(checkpoints[b.cutoffAssessment.checkpointType])} 已保存的資料評估。</p>`
        : `<p>今日資料完整性未知；${b.assessmentTradeDate ? `最近評估屬 ${escape(b.assessmentTradeDate)}，不能當成今日證據。` : '尚無有效評估。'}</p>`}
      <dl class="dop-times"><div><dt>排程工作</dt><dd>${escape(completion[b.scheduler.completion] || '排程證據未知')}</dd></div>
      <div><dt>實收證據（資料／時段列）</dt><dd>${current ? `有資料 ${escape(b.received.withRecords)} · 零筆 ${escape(b.received.zeroRecords)} · 未知 ${escape(b.received.unknown)}` : '未知'}</dd></div>
      <div><dt>cutoff 截止時點驗收</dt><dd>${pill(b.cutoffAssessment.state)}<br>${time(b.cutoffAssessment.at)}</dd></div>
      <div><dt>既有研究前置資格</dt><dd>${pill(b.researchPrerequisites.state)}</dd></div></dl>
      <p class="dop-muted">有列數不代表 cutoff 前已收到或完整；研究欄僅涵蓋壓力／價格反應／效率的既有前置條件。此摘要不驗證 MSI 即時運行狀態。</p></section>`;
  }
  function renderEvidence(row) {
    const e = row.evidenceSummary || {};
    return `實收筆數：${measurement(e.recordCount)}；應收筆數：${measurement(e.expectedRecordCount)}<br>
      首筆接收：${time(e.firstReceivedAt)}<br>末筆接收：${time(e.lastReceivedAt)}<br>
      來源日期：${escape(e.sourceDate)}<br>已驗證觀測時間：${time(e.observedAt)}<br>已驗證可用時間：${time(e.availableAt)}<br>
      缺段數：${measurement(e.missingIntervalCount)}；重複數：${measurement(e.duplicateCount)}；時間錯誤數：${measurement(e.timestampErrorCount)}<br>
      擷取 ${escape(row.captureState)}／涵蓋 ${escape(row.coverageState)}／保存 ${escape(row.persistenceState)}／完整性 ${escape(row.integrityState)}<br>
      用途資格：${escape(eligibilityLabels[row.researchEligibility] || '資格未知')}`;
  }
  function renderScheduler(s, view) {
    if (!s) return '<p>今日排程進度尚未取得。</p>';
    const today = view.availability === 'AVAILABLE' && view.tradeDate === s.tradeDate;
    return `<section class="dop-scheduler" aria-label="今日排程進度"><h3>今日進度 · ${escape(s.tradeDate)}</h3>
      <p>目前預定階段：${escape(s.expectedCheckpoint ? checkpoints[s.expectedCheckpoint] : s.applicability === 'NOT_EXPECTED' ? '非交易日，不要求執行' : '尚未到 DAY／仍待確認')}；${escape(s.policy?.timezone)} · 寬限 ${escape(s.policy?.graceMinutes)} 分鐘</p>
      <p>今天資料驗收：${today ? `${escape(view.checkpointType)} · ${escape(view.overallState)}，核心必需且已到期 ${escape(view.requiredAndDueCount)} 列` : '尚無今天有效資料評估，收集完整度未知；下方保留最近一次資料評估。'}</p>
      <div class="dop-checkpoints">${(s.checkpoints || []).map(c => `<article data-checkpoint="${escape(c.checkpointType)}" data-scheduler-state="${escape(c.state)}">
        <h4>${escape(c.label)}</h4><strong>${escape(schedulerLabels[c.state] || c.state)}</strong>
        <p>原定 ${escape(c.checkTime)} · 台北時間<br>實際開始：${taipeiTime(c.actualAttemptAt)}<br>完成：${taipeiTime(c.actualSuccessAt)}<br>延遲：${c.latenessMinutes == null ? '尚無紀錄' : `${escape(Number(c.latenessMinutes.toFixed(2)))} 分鐘`}</p>
        <p>${escape(c.reasonZh)}</p><p>影響：${escape(c.impactZh)}</p><p>下一步：${escape(c.minimumNextAction)}</p>
        <details><summary>執行證據</summary><p>最後成功：${time(c.lastSuccessAt)}</p><pre>${escape(JSON.stringify({ state: c.state, timeliness: c.timeliness,
          expectedAt: c.expectedAt, graceUntil: c.graceUntil, actualAttemptAt: c.actualAttemptAt, actualSuccessAt: c.actualSuccessAt,
          latenessMs: c.latenessMs, receipt: c.receipt, startObservation: c.startObservation,
          lastSuccessRunId: c.lastSuccessRunId, evidenceState: c.evidenceState }, null, 2))}</pre></details>
      </article>`).join('')}</div>
      <p>${escape(s.reasonZh || '排程檢查時間不是資料公布期限；排程未執行與驗收工作失敗均不等於 DATA FAIL。')}</p>
      <details><summary>當日完成度與準時性（分開記錄）</summary><p>${escape(s.completion)} · ${escape(s.punctuality)}；候選與手動測試不計入正式五日觀察。</p></details>
      <small>排程狀態觀測：${time(s.observedAt)}；來源資料時間未被更新。政策 ${escape(s.policy?.policyId)}</small></section>`;
  }
  function render(view) {
    const v = view || {}, h = v.acceptanceJobHealth || {};
    const available = v.availability === 'AVAILABLE';
    const failed = h.jobState === 'FAILED';
    const allGaps = v.gaps || [];
    const gaps = allGaps.slice(0, 6);
    const rows = v.rows || [];
    return `${renderBrief(v.dailyHealthBrief)}${renderScheduler(v.schedulerHealth, v)}<div class="dop-summary">
      <div><h3>${v.schedulerHealth && v.tradeDate !== v.schedulerHealth.tradeDate ? '最近一次資料營運評估' : '今日資料營運'}</h3><strong>${pill(v.overallState || 'UNKNOWN')}</strong>
      <p>${available ? `交易日 ${escape(v.tradeDate)} · ${escape(checkpoints[v.checkpointType])} · ${v.finalized ? '已 FINAL（不等於 PASS）' : '尚未 FINAL'}` : '尚無有效驗收產物，無法判定資料是否完整'}</p>
      <p class="dop-muted">${available ? `此評估資料截止：${time(v.inputGeneratedAt)}` : '等待首次有效驗收'}；驗收成功只表示完成檢查與保存。</p></div>
      <dl class="dop-times"><div><dt>最後自動驗收</dt><dd>${time(h.lastAutomaticAttemptAt)}</dd></div>
      <div><dt>最後成功（驗收寫入）</dt><dd>${time(h.lastSuccessAt)}</dd></div>
      <div><dt>最後 FINAL tradeDate</dt><dd>${escape(h.lastFinalizedTradeDate || '尚無紀錄')}</dd></div>
      <div><dt>本次工作</dt><dd>${escape(({ SUCCEEDED: '執行成功', FAILED: '驗收工作失敗', RUNNING: '驗收執行中', NOT_RUN: '尚未執行' })[h.jobState] || '工作狀態未驗證')}</dd></div></dl>
      </div>
      <p class="dop-mode">${h.runMode === 'SCHEDULED' ? '正式排程執行紀錄' : h.runMode === 'CANDIDATE_SCHEDULER_TEST' ? '候選排程測試；不計正式營運日' : h.runMode ? '手動／歷史證據驗收；不代表今天自動收集成功' : '尚無自動排程證據'}。資料營運狀態不代表交易訊號或策略就緒。</p>
      ${failed ? '<p class="dop-job-failure" role="status">驗收工作失敗：本次未完成驗收保存。下方保留最近有效資料評估與先前成功紀錄；請查看工作明細。</p>' : ''}
      <p>核心必需且已到期：<b>${escape(v.requiredAndDueCount)}</b>；${v.counts ? Object.entries(v.counts).map(([k, n]) => `${escape(k)} ${escape(n)}`).join(' · ') : '狀態筆數尚未取得'}</p>
      <h4>主要缺口與最小下一步</h4>
      ${gaps.length ? `<ul class="dop-gaps">${gaps.map(r => `<li><div><b>${escape(r.ownerLabelZh)} · ${escape(r.session)}</b> ${pill(r.operationalState)}</div>
        <p>${(r.reasonsZh || []).map(escape).join('；') || '驗收證據尚未完整'}</p>
        <p><span class="dop-muted">影響：</span>${(r.impactZh || []).map(escape).join('；')}</p>
        <p><span class="dop-muted">下一步：</span>${escape(r.minimumNextAction)}</p></li>`).join('')}</ul>`
      : `<p>${available ? '本次評估沒有列出的營運缺口；仍須依研究資格使用資料。' : '尚無驗收列可供確認；先核對驗收工作與受控 A.1 輸入。'}</p>`}
      ${allGaps.length > gaps.length ? `<p class="dop-muted">另有 ${allGaps.length - gaps.length} 列，請展開全部明細。</p>` : ''}
      <details class="dop-details"><summary>全部資料列、原始原因、處置與工作身分</summary>
        <p>筆數只描述驗收引用的資料檔；盤後補入不會改寫截止時點。缺段、重複及時間錯誤沒有量測時保留未知。</p>
        <div class="table-wrap"><table><thead><tr><th>資料／時段</th><th>狀態／應到</th><th>實收、時間與用途資格</th><th>原因與處置</th></tr></thead><tbody>${rows.map(r => `<tr>
          <td>${escape(r.ownerLabelZh)}<br>${escape(r.session)} · ${escape(r.operationalRole)}${r.inCheckpointScope ? '' : '（本 checkpoint 範圍外）'}</td>
          <td>${pill(r.operationalState)}<br>${escape(r.dueState)}</td><td>${renderEvidence(r)}</td><td>${(r.reasonsZh || []).map(escape).join('；')}<br>
          <code>${(r.reasonCodes || []).map(escape).join(' / ') || '無原因碼'}</code><br>${(r.remediation || []).map(a => `${escape(a.ownerLane)} / ${escape(a.actionClass)}：${escape(a.smallestNextCheck)}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>
        <h4>驗收工作、歷史指標與 lineage</h4><pre>${escape(JSON.stringify({ jobHealth: h, bindingIdentity: v.bindingIdentity ?? null, artifactIdentity: v.artifactIdentity ?? null,
          checkpoint: v.checkpointDetail ?? null, countsScope: v.countScope ?? null, history: v.history || [] }, null, 2))}</pre>
      </details>`;
  }
  function isOlder(next, previous) {
    if (previous?.schedulerHealth?.observedAt && (!next.schedulerHealth?.observedAt
      || next.schedulerHealth.observedAt < previous.schedulerHealth.observedAt)) return true;
    if (!previous || next.availability !== 'AVAILABLE' || previous.availability !== 'AVAILABLE') return false;
    if (next.tradeDate !== previous.tradeDate) return next.tradeDate < previous.tradeDate;
    const rank = Object.keys(checkpoints);
    if (rank.indexOf(next.checkpointType) < rank.indexOf(previous.checkpointType)) return true;
    if (next.generatedAt < previous.generatedAt) return true;
    if (next.generatedAt === previous.generatedAt && next.checkpointType === previous.checkpointType
      && next.artifactIdentity?.reportHash !== previous.artifactIdentity?.reportHash) return true;
    return (next.acceptanceJobHealth?.lastAttemptAt || '') < (previous.acceptanceJobHealth?.lastAttemptAt || '');
  }
  function createChannel({ request, display, status, unauthorized }) {
    let busy = false, previous = null, schedulerObservedAt = null, generation = 0, activeController = null;
    return { reset() {
      generation++; activeController?.abort(); activeController = null;
      busy = false; previous = null; schedulerObservedAt = null;
    }, async refresh() {
      if (busy) return;
      busy = true;
      const controller = new AbortController();
      const ticket = generation; activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      status('正在讀取驗收紀錄…');
      try {
        const payload = await request(controller.signal);
        if (ticket !== generation) return;
        if (!payload?.data || payload.data.schemaVersion !== 'dashboard-data-operations-v1') throw new Error('INVALID_RESPONSE');
        if (schedulerObservedAt && (!payload.data.schedulerHealth?.observedAt || payload.data.schedulerHealth.observedAt < schedulerObservedAt)) {
          status('收到較舊的排程觀測；保留已顯示版本。'); return;
        }
        if (isOlder(payload.data, previous)) { status('收到較舊或衝突的紀錄；保留已顯示版本，請核對驗收歷史。'); return; }
        if (payload.data.availability === 'AVAILABLE') previous = payload.data;
        schedulerObservedAt = payload.data.schedulerHealth?.observedAt || schedulerObservedAt;
        display(payload.data);
        status(payload.data.availability === 'AVAILABLE' ? '已讀取已保存紀錄（不改變來源時間）' : '目前無有效驗收產物');
      } catch (err) {
        if (ticket !== generation) return;
        status('驗收紀錄讀取失敗；既有顯示未更新，不能當作目前狀態。');
        if (err.status === 401) unauthorized();
      } finally { clearTimeout(timeout); if (ticket === generation) { busy = false; activeController = null; } }
    } };
  }
  root.DataOperations = Object.freeze({ render, isOlder, createChannel });
})(typeof window === 'undefined' ? globalThis : window);
