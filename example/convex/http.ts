import { httpRouter } from "convex/server";
import { registerStripeRoutes } from "./stripe/http";
const http = httpRouter();
registerStripeRoutes(http);
export default http;
