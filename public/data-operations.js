(function (root) {
  'use strict';
  const labels = { PASS: '完整', PARTIAL: '部分資料有缺口', UNKNOWN: '證據不足', PENDING: '等待資料', FAIL: '資料驗收未通過', NOT_EXPECTED: '本次不需收集' };
  const checkpoints = { DAY_CHECKPOINT: 'DAY 日盤', EOD_CHECKPOINT: 'EOD 盤後', FINAL_TRADEDATE_CHECKPOINT: 'FINAL 全交易日' };
  const escape = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const time = value => value ? escape(value.replace('T', ' ').replace('Z', ' UTC')) : '尚無紀錄';
  const pill = value => `<span class="dop-state" data-state="${escape(value)}">${escape(value)} · ${escape(labels[value] || '尚未驗證')}</span>`;
  function render(view) {
    const v = view || {}, h = v.acceptanceJobHealth || {};
    const available = v.availability === 'AVAILABLE';
    const failed = h.jobState === 'FAILED';
    const allGaps = v.gaps || [];
    const gaps = allGaps.slice(0, 6);
    const rows = v.rows || [];
    return `<div class="dop-summary">
      <div><h3>今日資料營運</h3><strong>${pill(v.overallState || 'UNKNOWN')}</strong>
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
        <div class="table-wrap"><table><thead><tr><th>資料／時段</th><th>狀態／應到</th><th>原因與處置</th></tr></thead><tbody>${rows.map(r => `<tr>
          <td>${escape(r.ownerLabelZh)}<br>${escape(r.session)} · ${escape(r.operationalRole)}${r.inCheckpointScope ? '' : '（本 checkpoint 範圍外）'}</td>
          <td>${pill(r.operationalState)}<br>${escape(r.dueState)}</td><td>${(r.reasonsZh || []).map(escape).join('；')}<br>
          <code>${(r.reasonCodes || []).map(escape).join(' / ') || '無原因碼'}</code><br>${(r.remediation || []).map(a => `${escape(a.ownerLane)} / ${escape(a.actionClass)}：${escape(a.smallestNextCheck)}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>
        <h4>驗收工作、歷史指標與 lineage</h4><pre>${escape(JSON.stringify({ jobHealth: h, artifactIdentity: v.artifactIdentity ?? null,
          checkpoint: v.checkpointDetail ?? null, countsScope: v.countScope ?? null, history: v.history || [] }, null, 2))}</pre>
      </details>`;
  }
  function isOlder(next, previous) {
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
    let busy = false, previous = null;
    return { async refresh() {
      if (busy) return;
      busy = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      status('正在讀取驗收紀錄…');
      try {
        const payload = await request(controller.signal);
        if (!payload?.data || payload.data.schemaVersion !== 'dashboard-data-operations-v1') throw new Error('INVALID_RESPONSE');
        if (isOlder(payload.data, previous)) { status('收到較舊或衝突的紀錄；保留已顯示版本，請核對驗收歷史。'); return; }
        previous = payload.data;
        display(previous);
        status(previous.availability === 'AVAILABLE' ? '已讀取已保存紀錄（不改變來源時間）' : '目前無有效驗收產物');
      } catch (err) {
        status('驗收紀錄讀取失敗；既有顯示未更新，不能當作目前狀態。');
        if (err.status === 401) unauthorized();
      } finally { clearTimeout(timeout); busy = false; }
    } };
  }
  root.DataOperations = Object.freeze({ render, isOlder, createChannel });
})(typeof window === 'undefined' ? globalThis : window);
