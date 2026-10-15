import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';import {componentsGeneric} from 'convex/server';
import {BetterStripe} from '/path/to/better-stripe/src/client/index.ts';
const cwd='/path/to/better-stripe/example';
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
function query(ref:any,args:any){const full=ref[Symbol.for('toReferencePath')];assert(full.endsWith('/connect/queries/getTransferByStripeId'));return JSON.parse(execFileSync('pnpm',['exec','convex','run','--component','betterStripe','connect/queries:getTransferByStripeId',JSON.stringify(args)],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null');}
const bs=new BetterStripe(componentsGeneric().betterStripe as any,{STRIPE_SECRET_KEY:key});const ctx:any={runQuery:query};
const pending=JSON.parse(readFileSync('/tmp/recipient-receipt-inspect.json','utf8'));const reversed=JSON.parse(readFileSync('/tmp/recipient-reversal-inspect.json','utf8'));
const report:any={sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),sandbox:true,readOnly:true,publicClient:true,deployedComponentLedger:true,apiVersion:'2026-09-30.endive'};
try{
 const opts={accountId:pending.accountId,stripeTransferId:pending.transferId};
 const a=await bs.payoutPolicy.transferReceipt(ctx,opts);assert.equal(a.status,'ready');if(a.status==='ready'){assert.equal(a.matureNet,0);assert.equal(a.pendingCredits,4014);report.pendingSource={transferId:a.stripeTransferId,totalNet:a.totalNet,matureNet:a.matureNet,pendingCredits:a.pendingCredits,transactions:a.transactions};}
 const b=await bs.payoutPolicy.transferReceipt(ctx,{accountId:pending.accountId,stripeTransferId:reversed.transferId});assert.equal(b.status,'ready');if(b.status==='ready'){assert.equal(b.totalNet,0);assert.equal(b.matureNet,0);assert.equal(b.pendingCredits,0);assert(b.transactions.length>=3);report.fullyReversedPendingSource={transferId:b.stripeTransferId,providerReversed:b.providerReversedAmount,totalNet:b.totalNet,matureNet:b.matureNet,pendingCredits:b.pendingCredits,transactions:b.transactions};}
 const limited=await bs.payoutPolicy.transferReceipt(ctx,{...opts,maxRequests:1});assert.equal(limited.status,'not_ready');assert.equal(limited.reason,'history_incomplete');assert(!('totalNet' in limited));report.budgetFailsClosed=true;
 await assert.rejects(bs.payoutPolicy.transferReceipt(ctx,{...opts,accountId:'acct_foreign'}),/identity/);report.foreignAccountRejected=true;
 report.noFinancialWrites=true;report.noUnpaidEntitlementClaim=true;report.status='passed';
}catch(error:any){report.status='failed';report.error={message:error.message,code:error.code};process.exitCode=1;}
finally{writeFileSync('/tmp/transfer-receipt-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
