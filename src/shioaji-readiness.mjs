function flag(value) {
  return value === true;
}

export function buildShioajiReadiness(input = {}) {
  const pythonAvailable = flag(input.pythonAvailable);
  const packageInstalled = flag(input.packageInstalled);
  const serverReachable = flag(input.serverReachable);
  const projectHasApiKey = flag(input.projectHasApiKey);
  const projectHasSecretKey = flag(input.projectHasSecretKey);
  const futuresAccount = flag(input.futuresAccount);
  const futuresApiSigned = flag(input.futuresApiSigned);

  const blockers = [];
  if (!pythonAvailable) blockers.push('python_not_available');
  if (!packageInstalled) blockers.push('shioaji_not_installed');
  if (!serverReachable) blockers.push('local_market_service_not_running');
  if (!futuresAccount) blockers.push('futures_account_not_confirmed');
  if (!futuresApiSigned) blockers.push('futures_api_not_signed');
  if (projectHasApiKey || projectHasSecretKey) blockers.push('broker_secret_present_in_dashboard_process');

  return {
    schemaVersion: '1.0.0',
    provider: 'shioaji',
    mode: 'market_data_only',
    pythonAvailable,
    packageInstalled,
    serverReachable,
    futuresAccount,
    futuresApiSigned,
    secretsIsolatedFromDashboard: !projectHasApiKey && !projectHasSecretKey,
    readyForLocalMarketDataTest:
      pythonAvailable &&
      packageInstalled &&
      serverReachable &&
      !projectHasApiKey &&
      !projectHasSecretKey,
    readyForTxResearch:
      pythonAvailable &&
      packageInstalled &&
      serverReachable &&
      futuresAccount &&
      futuresApiSigned &&
      !projectHasApiKey &&
      !projectHasSecretKey,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    blockers,
  };
}

