import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
const exec=promisify(execFile);const cwd='<repo>/example';
async function call(module:string,fn:string,args:object){try{const {stdout}=await exec('pnpm',['exec','convex','run','--component','betterStripe',`costRecovery/${module}:${fn}`,JSON.stringify(args)],{cwd,encoding:'utf8',timeout:120000});return JSON.parse(stdout.trim());}catch(error:any){throw new Error(String(error.stderr??error.message));}}
const run='bts146-qa-'+crypto.randomUUID();const scope={accountId:'acct_cost_claims_qa',scopeKey:run,currency:'usd'};
const claim={...scope,claimKey:run+':claim',sourceChargeId:run+':original-charge',sourceGross:10000,sourceProcessingFee:320,amountDue:500,revision:1};
const reservation=(suffix:string)=>({...scope,groupKey:run+':'+suffix,operationKey:run+':'+suffix+':batch1',sourceKind:'settlement',sourceId:run+':funding-charge',sourceGross:10000,sourceProcessingFee:320,maxDebit:10000,maxCredit:10000});
const report:any={deployedDevelopmentComponent:true,bookkeepingOnly:true,noProviderCalls:true};
try{
 await call('mutations','record',claim);
 const results=await Promise.allSettled([call('mutations','reserve',reservation('one')),call('mutations','reserve',reservation('two'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const success:any=results.find(r=>r.status==='fulfilled');const winner=success.value;
 const suffix=winner.group.groupKey.endsWith(':one')?'one':'two';
 const replay=await call('mutations','reserve',reservation(suffix));assert.equal(replay.reservation._id,winner.reservation._id);report.concurrentBoundariesSerialized=true;report.retryKeptSameReservation=true;
 await call('mutations','seal',{groupKey:winner.group.groupKey});
 await call('mutations','finish',{groupKey:winner.group.groupKey,outcome:'collect'});
 await call('mutations','finish',{groupKey:winner.group.groupKey,outcome:'collect'});
 let ledger=await call('queries','balance',scope);assert.equal(ledger.collectedAmount,500);assert.equal(ledger.outstanding,0);report.completionRetryNoDuplicateCollection=true;
 await call('mutations','record',{...claim,amountDue:0,revision:2});ledger=await call('queries','balance',scope);assert.equal(ledger.outstanding,-500);
 const credit=await call('mutations','reserve',reservation('credit'));assert.equal(credit.reservation.amount,-500);
 await call('mutations','seal',{groupKey:credit.group.groupKey});await call('mutations','finish',{groupKey:credit.group.groupKey,outcome:'collect'});
 ledger=await call('queries','balance',scope);assert.equal(ledger.outstanding,0);assert.equal(ledger.collectedAmount,0);assert.equal(ledger.reservedAmount,0);assert(!ledger.activeGroupKey);
 report.signedCreditReconciled=true;report.finalBalance={amountDue:ledger.amountDue,collectedAmount:ledger.collectedAmount,reservedAmount:ledger.reservedAmount,outstanding:ledger.outstanding};report.nonBillableQaScopeHasNoPendingObligation=true;
 await call('mutations','record',{...claim,amountDue:900,revision:1});assert.equal((await call('queries','balance',scope)).outstanding,0);report.staleReplayIgnored=true;report.status='passed';
}catch(error:any){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{writeFileSync('/tmp/cost-claims-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
