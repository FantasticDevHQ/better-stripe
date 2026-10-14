import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';import Stripe from 'stripe';
process.chdir('<repo>/example');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=new Stripe(key,{apiVersion:'2026-09-30.preview'});
function call(name:string,args:object):any{return JSON.parse(execFileSync('pnpm',['exec','convex','run','sandboxRenewals:'+name,JSON.stringify(args)],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim() || 'null');}
async function wait(sellerId:string, predicate:(s:any)=>boolean){const deadline=Date.now()+180000;let s:any;while(Date.now()<deadline){s=call('snapshot',{sellerId});if(predicate(s))return s;await delay(3000);}throw Error('Renewal timeout: '+JSON.stringify({clock:s?.clockStatus,invoice:s?.invoice,payment:s?.payment}));}
const report:any={sandbox:true,realProvider:true,deployedExampleAdapter:true,scope:'balance-funded renewal only; refund/dispute cost fixture gap tracked in BTS-139/BTS-140'};
async function scenario(name:'funded'|'insufficient') {
 let actor:any;const result:any={};report[name]=result;
 try {
  actor=call('prepare',{runId:'bts-138-provider-20261014',scenario:name});console.log(name+': prepared');
  if(name==='funded') {
   for(let attempt=0;;attempt++){try{call('fund',{sellerId:actor.sellerId});break;}catch(e){if(attempt>=11)throw e;await delay(5000);}}
  }
  const before=await wait(actor.sellerId,s=>s.invoice.status==='paid' && s.clockStatus==='ready');
  const total=before.invoice.total;assert.equal(total,900);
  if(name==='funded')assert(before.available>=total);else assert(before.available<total);
  call('advance',{sellerId:actor.sellerId,frozenTime:actor.periodEnd+1});
  const draft=await wait(actor.sellerId,s=>s.clockStatus==='ready'&&s.invoice.reason==='subscription_cycle');
  assert.equal(draft.invoice.total,total);call('advance',{sellerId:actor.sellerId,frozenTime:actor.periodEnd+7201});
  const end=await wait(actor.sellerId,s=>s.clockStatus==='ready'&&(name==='funded'?s.invoice.status==='paid':(s.payment.declineCode==='insufficient_funds'||s.payment.errorCode==='insufficient_funds')));
  assert.equal(end.invoice.id,draft.invoice.id);assert.equal(end.payment.method,'stripe_balance');
  result.totalMinorUnits=total;result.currency='usd';result.providerPaymentMethod='stripe_balance';
  if(name==='funded') {
   assert.equal(end.invoice.amountPaid,total);assert.equal(end.available,before.available-total);assert.equal(end.debits.filter((d:any)=>d.amount===-total).length,1);
   try{call('retry',{sellerId:actor.sellerId});}catch(e){assert(/already paid/i.test(String((e as any).stderr ?? e)));}
   const retried=call('snapshot',{sellerId:actor.sellerId});assert.equal(retried.available,end.available);
   result.paidOnce=true;result.repeatedPaidInvoiceNoDuplicateDebit=true;result.accessActive=end.hasAccess;
  } else {
   assert.equal(end.invoice.amountPaid,0);assert.equal(end.invoice.amountRemaining,total);assert.equal(end.available,before.available);assert.equal(end.debits.length,0);
   result.insufficientFunds=true;result.noBalanceDebit=true;result.noAutomaticCardFallback=true;result.storeAccessClosed=!end.hasAccess;
  }
  console.log(name+': passed');
 }finally{
  if(actor){const sub=await sdk.subscriptions.retrieve(actor.subscriptionId);if(sub.status!=='canceled')call('finish',{sellerId:actor.sellerId});result.subscriptionCanceled=true;}
 }
}
try{await scenario('funded');await scenario('insufficient');report.status='passed';}finally{writeFileSync('/tmp/balance-funding-live-renewals.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
