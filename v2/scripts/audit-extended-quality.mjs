import fs from'node:fs';import path from'node:path';import{applyMigrations,openDatabase}from'../src/db.mjs';import{v2Config}from'../src/config.mjs';
const config=v2Config();const db=openDatabase(config.databasePath);
try{applyMigrations(db,config.migrationsPath);const lending=db.prepare(`WITH x AS (
 SELECT *,LAG(lending_balance) OVER(ORDER BY trade_date) previous_lending,
 LAG(short_sale_balance) OVER(ORDER BY trade_date) previous_short
 FROM securities_lending_daily WHERE symbol='__TWSE_COMMON_STOCKS__')
 SELECT COUNT(*) rows,
 SUM(CASE WHEN previous_lending IS NOT NULL AND lending_balance<>previous_lending+lending_new-lending_return THEN 1 ELSE 0 END) lending_formula_mismatch,
 SUM(CASE WHEN previous_short IS NOT NULL AND short_sale_balance<>previous_short+short_sale_quantity-short_sale_buyback+short_sale_adjustment THEN 1 ELSE 0 END) short_formula_mismatch
 FROM x`).get();const breadth=db.prepare(`SELECT market,COUNT(*) rows,
 SUM(CASE WHEN advance<0 OR decline<0 OR limit_up<0 OR limit_down<0 OR limit_up>advance OR limit_down>decline THEN 1 ELSE 0 END) invalid_rows
 FROM market_breadth_history_daily GROUP BY market ORDER BY market`).all();const option=db.prepare(`SELECT COUNT(DISTINCT trade_date) days,COUNT(*) contracts,
 SUM(CASE WHEN atm_iv<=0 OR atm_iv>4 THEN 1 ELSE 0 END) invalid_atm_iv,
 SUM(CASE WHEN skew_25d IS NOT NULL AND ABS(skew_25d)>2 THEN 1 ELSE 0 END) invalid_skew
 FROM option_volatility_daily`).get();const report={generatedAt:new Date().toISOString(),lending,breadth,option,
 passed:lending.rows>=700&&breadth.every(x=>x.rows>=700&&x.invalid_rows===0)&&option.days>=700&&option.invalid_atm_iv===0&&option.invalid_skew===0,
 notes:['Aggregate lending formula mismatches can occur when the four-digit common-stock universe changes; values are reported rather than silently repaired.']};fs.writeFileSync(path.join(config.reportsPath,'v3-6-2-extended-quality-audit.json'),`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report,null,2));}finally{db.close();}
