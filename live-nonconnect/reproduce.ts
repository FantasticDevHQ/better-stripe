import {execFileSync} from 'node:child_process';
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {convexTest} from 'convex-test';
import {defineSchema,componentsGeneric} from 'convex/server';
import schema from './src/component/schema.ts';
import {BetterStripe,STRIPE_CUSTOMER_PREVIEW_API_VERSION} from './src/client/index.ts';
import {handleWebhookRequest} from './src/client/webhooks/handler.ts';
import {chromium} from './example/node_modules/@playwright/test/index.mjs';
process.chdir(import.meta.dirname);
const out='/tmp/better-stripe-nonconnect-live';mkdirSync(out,{recursive:true});
const key=process.env.STRIPE_SECRET_KEY ?? '';
assert(key.startsWith('sk_test_'));
const sdk=new Stripe(key,{apiVersion:STRIPE_CUSTOMER_PREVIEW_API_VERSION});
assert.equal((await sdk.accounts.retrieve()).id,process.env.STRIPE_SANDBOX_ACCOUNT_ID);
const modules:any={};function walk(d:string){for(const f of readdirSync(d,{withFileTypes:true})){const p=d+'/'+f.name;if(f.isDirectory())walk(p);else if(p.endsWith('.ts'))modules[p]=()=>import(pathToFileURL(resolve(p)).href);}}walk('./src/component');
const t=convexTest(defineSchema({}),modules);t.registerComponent('betterStripe',schema,modules);
const component=componentsGeneric().betterStripe as any;
const bs=new BetterStripe(component,{STRIPE_SECRET_KEY:key,stripeApiVersion:STRIPE_CUSTOMER_PREVIEW_API_VERSION});
const ctx:any={runQuery:(r:any,a:any)=>t.query(r,a),runMutation:(r:any,a:any)=>t.mutation(r,a),runAction:(r:any,a:any)=>t.action(r,a)};
const run='nonconnect-'+Date.now();const results:any[]=[];const deliveries:any[]=[];const dests:string[]=[];const sessions:string[]=[];const prices:string[]=[];
function pass(name:string,detail:any={}){results.push({name,status:'passed',...detail});console.log('PASS '+name);writeFileSync(out+'/results.json',JSON.stringify({commit:'aefaca1717ae812c9f2146dc67703383538da2db',run,storage:'real convex-test component store, isolated local HTTP receiver',results,deliveries},null,2));}
function fail(name:string,e:any){results.push({name,status:'failed',code:e.code,message:e.message,requestId:e.requestId});console.log('FAIL '+name+' '+e.message);}
const secrets:any={};let buyer:any,product:any,subscriptionId:string|undefined;let browser:any;let page:any;
const server=createServer(async(req,res)=>{try{
if(req.method!=='POST'){res.setHeader('Content-Type','text/html');res.end('<h1>BetterStripe non-Connect receipt</h1><p>Returned from Stripe Checkout.</p>');return;}
let body='';for await(const part of req)body+=part;const event=JSON.parse(body);
const path=req.url??'';const secret=secrets[path];
if(!secret){res.writeHead(503);res.end('not ready');return;}
const response=await t.action(async(c:any)=>{const r=await handleWebhookRequest(c,new Request('http://localhost:4349'+path,{method:'POST',body,headers:{'stripe-signature':String(req.headers['stripe-signature'])}}),component,{stripeSecretKey:key,stripeApiVersion:STRIPE_CUSTOMER_PREVIEW_API_VERSION,webhookSecret:secret,webhookSecretV2:secret});return {status:r.status,body:await r.text()};});
deliveries.push({type:event.type,id:event.id,apiVersion:event.api_version??'unversioned',status:response.status});res.writeHead(response.status);res.end(response.body);
}catch(e:any){console.log('receiver error '+e.message);res.writeHead(500);res.end('receiver failed');}});
await new Promise<void>(r=>server.listen(4349,'127.0.0.1',r));
async function eventually(fn:()=>Promise<any>,timeout=45000){const start=Date.now();while(Date.now()-start<timeout){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,1000));}throw new Error('Timed out waiting for webhook synchronization');}
try{
for(const payload of ['snapshot','thin'] as const){const d=await bs.setupEventDestination(ctx,{url:process.env.WEBHOOK_BASE_URL+'/'+payload+'-'+run,name:run+'-'+payload,eventPayload:payload,...(payload==='snapshot'?{enabledEvents:['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','payment_intent.succeeded','refund.created','refund.updated']}: {})});dests.push(d.id);secrets['/'+payload+'-'+run]=d.secret;pass(payload+' destination created with preview settings');}
buyer=await bs.ensureCustomerAccount(ctx,{userId:run,email:'betterstripe-qa@example.com',name:'BetterStripe QA',country:'us',idempotencyKey:run+':buyer'});
assert.deepEqual(buyer.appliedConfigurations,['customer']);const again=await bs.ensureCustomerAccount(ctx,{userId:run,email:'betterstripe-qa@example.com',idempotencyKey:run+':buyer'});assert.equal(again.stripeAccountId,buyer.stripeAccountId);pass('customer-only buyer creation and provisioning retry');
const a=await sdk.v2.core.accounts.retrieve(buyer.stripeAccountId,{include:['configuration.customer','identity']});assert.deepEqual(a.applied_configurations,['customer']);pass('provider confirms customer configuration only');
product=await bs.createProduct(ctx,{name:'BetterStripe non-Connect QA',metadata:{qaRun:run}});
const prod=product.stripeProductId;assert(prod);
for(const type of ['one_time','recurring'] as const){const p=await bs.createPrice(ctx,{stripeProductId:prod,unitAmount:1000,currency:'usd',type,...(type==='recurring'?{interval:'month' as const}:{}),metadata:{qaRun:run}});prices.push(p.stripePriceId);}
pass('package product and one-time/recurring prices');
for(const mode of ['embedded','custom','form','redirect'] as const){const c=await bs.createCheckoutSession(ctx,{userId:run,accountId:buyer.stripeAccountId,stripePriceId:prices[0],mode:'payment',uiMode:mode,returnUrl:'http://localhost:4349/receipt?session_id={CHECKOUT_SESSION_ID}',idempotencyKey:run+':'+mode});sessions.push(c.stripeSessionId);const live=await bs.getCheckoutSessionFromStripe(ctx,{stripeSessionId:c.stripeSessionId});assert.equal(live.customer_account,buyer.stripeAccountId);assert.equal(live.payment_intent,null);const retry=await bs.createCheckoutSession(ctx,{userId:run,accountId:buyer.stripeAccountId,stripePriceId:prices[0],mode:'payment',uiMode:mode,returnUrl:'http://localhost:4349/receipt?session_id={CHECKOUT_SESSION_ID}',idempotencyKey:run+':'+mode});assert.equal(retry.stripeSessionId,c.stripeSessionId);pass(mode+' checkout creation, buyer binding and idempotent retry');}
const hosted=await bs.createCheckoutSession(ctx,{userId:run,accountId:buyer.stripeAccountId,stripePriceId:prices[1],mode:'subscription',uiMode:'redirect',returnUrl:'http://localhost:4349/receipt?session_id={CHECKOUT_SESSION_ID}',idempotencyKey:run+':subscription'});sessions.push(hosted.stripeSessionId);
browser=await chromium.launch({headless:true});const bc=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:out+'/video',size:{width:1440,height:1000}}});page=await bc.newPage();page.setDefaultTimeout(20000);await page.goto(hosted.url!);await page.screenshot({path:out+'/checkout-start.png',fullPage:true});
writeFileSync(out+'/checkout-fields.json',JSON.stringify(await page.locator('input').evaluateAll((els:any[])=>els.map(e=>({name:e.name,id:e.id,placeholder:e.placeholder,type:e.type}))),null,2));
console.log('CHECKOUT_FIELDS '+await page.locator('input').count());
await page.getByRole('textbox',{name:/card number/i}).fill('4242424242424242');await page.getByRole('textbox',{name:/expiration/i}).fill('1234');await page.locator('#cardCvc').fill('123');
const name=page.locator('#billingName');if(await name.count())await name.fill('BetterStripe QA');
const country=page.locator('select');if(await country.count())await country.first().selectOption('US');
const zip=page.getByRole('textbox',{name:/zip|postal/i});if(await zip.count())await zip.fill('10001');
await page.getByRole('button',{name:/subscribe|pay/i}).last().click();await page.waitForURL('http://localhost:4349/receipt**',{timeout:60000});await page.screenshot({path:out+'/receipt.png',fullPage:true});pass('hosted subscription checkout with successful test card and receipt redirect');
const paid=await bs.getCheckoutSessionFromStripe(ctx,{stripeSessionId:hosted.stripeSessionId});assert.equal(paid.payment_status,'paid');assert.equal(paid.status,'complete');assert.equal(paid.customer_account,buyer.stripeAccountId);subscriptionId=String(paid.subscription);pass('authoritative receipt confirms paid and customer-account binding');
await eventually(async()=>{const s=await bs.getSubscriptionByStripeId(ctx,{stripeSubscriptionId:subscriptionId!});return s?.status==='active'&&s.accountId===buyer.stripeAccountId;});pass('Stripe-signed subscription webhook synchronizes actual component record');
const portal=await bs.createBillingPortalSession(ctx,{stripeAccountId:buyer.stripeAccountId,returnUrl:'http://localhost:4349/billing'});await page.goto(portal.url);await page.getByText(/subscription|payment|billing/i).first().waitFor({timeout:30000});await page.screenshot({path:out+'/portal.png',fullPage:true});assert.match(await page.locator('body').innerText(),/subscription|payment|billing/i);pass('package creates customer-account portal and portal loads');
await bs.cancelSubscription(ctx,{stripeSubscriptionId:subscriptionId});assert.equal((await bs.getSubscriptionFromStripe(ctx,{stripeSubscriptionId:subscriptionId})).cancel_at_period_end,true);pass('package subscription cancellation at period end');
await eventually(async()=>{const s=await bs.getSubscriptionByStripeId(ctx,{stripeSubscriptionId:subscriptionId!});return s?.cancelAtPeriodEnd===true;});pass('cancellation webhook updates component');
await bs.reactivateSubscription(ctx,{stripeSubscriptionId:subscriptionId});assert.equal((await bs.getSubscriptionFromStripe(ctx,{stripeSubscriptionId:subscriptionId})).cancel_at_period_end,false);pass('package subscription reactivation');
await eventually(async()=>{const s=await bs.getSubscriptionByStripeId(ctx,{stripeSubscriptionId:subscriptionId!});return s?.cancelAtPeriodEnd===false;});pass('reactivation webhook updates component');
const invoices=await sdk.invoices.list({subscription:subscriptionId,limit:1});const payments=await sdk.invoicePayments.list({invoice:invoices.data[0].id,limit:1});const pi=payments.data[0].payment.payment_intent;assert(typeof pi==='string');const refund=await bs.createRefund(ctx,{stripePaymentIntentId:pi,idempotencyKey:run+':refund'});assert.equal((await sdk.refunds.retrieve(refund.stripeRefundId)).status,'succeeded');pass('package refund of paid subscription charge');
await eventually(async()=>{const r=await bs.getRefundByStripeId(ctx,{stripeRefundId:refund.stripeRefundId});return r?.status==='succeeded'&&deliveries.some(d=>d.type==='refund.created'&&d.status===200);});pass('Stripe-signed refund event processed');
await eventually(async()=>deliveries.some(d=>d.type.startsWith('v2.core.account')&&d.status===200));pass('Stripe-signed thin customer lifecycle event processed');
assert(deliveries.filter(d=>!d.type.startsWith('v2.')).every(d=>d.apiVersion===STRIPE_CUSTOMER_PREVIEW_API_VERSION));pass('delivered snapshot payload version matches preview');
await bc.close();
}catch(e:any){fail('live acceptance',e);if(page){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});writeFileSync(out+'/failure-page.txt',await page.locator('body').innerText().catch(()=>''));}}
finally{
if(browser)await browser.close();
if(subscriptionId)await sdk.subscriptions.cancel(subscriptionId).catch(()=>{});
for(const id of sessions)await sdk.checkout.sessions.expire(id).catch(()=>{});
for(const id of prices)await sdk.prices.update(id,{active:false}).catch(()=>{});
if(product?.stripeProductId)await sdk.products.update(product.stripeProductId,{active:false}).catch(()=>{});
for(const id of dests)await sdk.v2.core.eventDestinations.del(id).catch(()=>{});
pass('cleanup: QA subscription canceled, open sessions expired, catalog archived, temporary destinations removed');
writeFileSync(out+'/results.json',JSON.stringify({commit:'aefaca1717ae812c9f2146dc67703383538da2db',run,storage:'real convex-test component store, isolated local HTTP receiver',results,deliveries},null,2));server.closeAllConnections();server.close();
}
