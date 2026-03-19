/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ResendOTP from "../ResendOTP.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as inboundEmail from "../inboundEmail.js";
import type * as inboundMutations from "../inboundMutations.js";
import type * as localQa from "../localQa.js";
import type * as mutations from "../mutations.js";
import type * as notifications from "../notifications.js";
import type * as notificationsModel from "../notificationsModel.js";
import type * as queries from "../queries.js";
import type * as trips from "../trips.js";
import type * as verification from "../verification.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ResendOTP: typeof ResendOTP;
  admin: typeof admin;
  auth: typeof auth;
  http: typeof http;
  inboundEmail: typeof inboundEmail;
  inboundMutations: typeof inboundMutations;
  localQa: typeof localQa;
  mutations: typeof mutations;
  notifications: typeof notifications;
  notificationsModel: typeof notificationsModel;
  queries: typeof queries;
  trips: typeof trips;
  verification: typeof verification;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
