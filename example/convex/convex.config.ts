import betterStripe from '@kellykampen/better-stripe/convex.config';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(betterStripe);
export default app;
