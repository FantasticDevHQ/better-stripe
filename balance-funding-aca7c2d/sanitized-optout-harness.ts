import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import Stripe from 'stripe';
process.chdir('<repo>/example');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=new Stripe(key,{apiVersion:'2026-09-30.preview'});
function call(name:string,args:object):any{return JSON.parse(execFileSync('pnpm',['exec','convex','run',name,JSON.stringify(args)],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim() || 'null');}
const report:any={sandbox:true,realProvider:true,deployedExampleAdapter:true};let actor:any;
try {
 actor=call('sandboxRenewals:prepare',{runId:'bts-138-optout-20261014',scenario:'funded'});
 const original=call('storeBalanceFunding:read',{sellerId:actor.sellerId});
 assert.equal(original.enabled,true);
 let sub=await sdk.subscriptions.retrieve(actor.subscriptionId);assert.equal(sub.default_payment_method,original.paymentMethodId);assert.deepEqual(sub.payment_settings.payment_method_types,['stripe_balance']);
 call('storeBalanceActions:setFunding',{sellerId:actor.sellerId,enabled:false});
 sub=await sdk.subscriptions.retrieve(actor.subscriptionId);assert.equal(sub.default_payment_method,original.previousPaymentMethodId ?? null);assert.deepEqual(sub.payment_settings.payment_method_types,original.previousPaymentMethodTypes ?? null);
 assert.equal(call('storeBalanceFunding:read',{sellerId:actor.sellerId}).enabled,false);report.optOutRestoresOriginalDefaultAndTypes=true;
 call('storeBalanceActions:setFunding',{sellerId:actor.sellerId,enabled:false});report.repeatedOptOutSafe=true;
 call('storeBalanceActions:setFunding',{sellerId:actor.sellerId,enabled:true,consent:true});
 const reenabled=call('storeBalanceFunding:read',{sellerId:actor.sellerId});assert(reenabled.operationVersion>original.operationVersion);sub=await sdk.subscriptions.retrieve(actor.subscriptionId);assert.equal(sub.default_payment_method,original.paymentMethodId);report.newCycleUsesNewDurableIdentity=true;
 call('storeBalanceActions:setFunding',{sellerId:actor.sellerId,enabled:false});
 sub=await sdk.subscriptions.retrieve(actor.subscriptionId);assert.equal(sub.default_payment_method,original.previousPaymentMethodId ?? null);report.repeatedCycleRestoresOriginal=true;
}finally{if(actor)call('sandboxRenewals:finish',{sellerId:actor.sellerId});report.trialOrSubscriptionCanceled=Boolean(actor);writeFileSync('/tmp/balance-funding-live-optout.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
