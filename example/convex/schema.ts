import { defineSchema } from "convex/server";
import { affiliateDefaultsTables } from "./affiliateDefaults/schema";
import { marketplaceTables } from "./marketplace/schema";
import { sandboxFixturesTables } from "./sandboxFixtures/schema";
import { sellerAffiliateRatesTables } from "./sellerAffiliateRates/schema";
import { sellerCostsTables } from "./sellerCosts/schema";
import { settlementTables } from "./settlement/schema";
import { storeBalanceTables } from "./storeBalance/schema";
import { storePlansTables } from "./storePlans/schema";
import { stripeTables } from "./stripe/schema";
import { usersTables } from "./users/schema";
export default defineSchema({
  ...usersTables,
  ...storeBalanceTables,
  ...affiliateDefaultsTables,
  ...sellerAffiliateRatesTables,
  ...storePlansTables,
  ...marketplaceTables,
  ...settlementTables,
  ...sellerCostsTables,
  ...sandboxFixturesTables,
  ...stripeTables,
});
