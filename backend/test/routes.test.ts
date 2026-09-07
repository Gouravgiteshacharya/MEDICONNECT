import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UserRole } from "../src/auth/authenticator.js";
import type { RouteStore } from "../src/delivery-routing/route.service.js";
import type { RouteProvider } from "../src/delivery-routing/route-provider.js";

const batchId="60000000-0000-0000-0000-000000000001", riderId="10000000-0000-0000-0000-000000000001", userId="20000000-0000-0000-0000-000000000001", now=new Date("2026-08-31T12:00:00Z");
const authenticate:RequestHandler=(req,_res,next)=>{const role=req.header("authorization")?.replace("Bearer ","") as UserRole|undefined;if(role)req.user={id:userId,role};next()};
function createStore(options:{missing?:boolean;conflicts?:number}={}) {
  let transactions=0, providerDuringTransaction=false, attempts=0;
  const acceptedAt=new Date(now.getTime()-5*60_000);
  const stops:any[]=[
    {id:"00000000-0000-0000-0000-000000000001",assignmentId:"a",orderId:"oa",stopType:"PHARMACY_PICKUP",sequence:1,latitude:0,longitude:1,addressLabel:"A pharmacy",status:"PENDING",estimatedArrivalAt:null,updatedAt:new Date("2026-08-31T11:59:00Z"),assignment:{acceptedAt,order:{orderNumber:"MED-A",quotedEtaMinutes:30}}},
    {id:"00000000-0000-0000-0000-000000000002",assignmentId:"a",orderId:"oa",stopType:"CUSTOMER_DROPOFF",sequence:2,latitude:0,longitude:4,addressLabel:"A customer",status:"PENDING",estimatedArrivalAt:null,updatedAt:new Date("2026-08-31T11:59:00Z"),assignment:{acceptedAt,order:{orderNumber:"MED-A",quotedEtaMinutes:30}}},
    {id:"00000000-0000-0000-0000-000000000003",assignmentId:"b",orderId:"ob",stopType:"PHARMACY_PICKUP",sequence:3,latitude:0,longitude:2,addressLabel:"B pharmacy",status:"PENDING",estimatedArrivalAt:null,updatedAt:new Date("2026-08-31T11:59:00Z"),assignment:{acceptedAt,order:{orderNumber:"MED-B",quotedEtaMinutes:30}}},
    {id:"00000000-0000-0000-0000-000000000004",assignmentId:"b",orderId:"ob",stopType:"CUSTOMER_DROPOFF",sequence:4,latitude:0,longitude:3,addressLabel:"B customer",status:"PENDING",estimatedArrivalAt:null,updatedAt:new Date("2026-08-31T11:59:00Z"),assignment:{acceptedAt,order:{orderNumber:"MED-B",quotedEtaMinutes:30}}},
  ];
  const batch={id:batchId,riderId,status:"ACTIVE",createdAt:new Date(now.getTime()-10*60_000),startedAt:acceptedAt,rider:{currentLatitude:0,currentLongitude:0},stops};
  const store:RouteStore={deliveryBatch:{findFirst:async(args:any)=>options.missing||args.where?.rider?.userId==="wrong"?null:batch},deliveryStop:{findMany:async()=>stops.map(({id,status,updatedAt})=>({id,status,updatedAt})),updateMany:async(args:any)=>{const item=stops.find((stop)=>stop.id===args.where.id);if(!item)return{count:0};Object.assign(item,args.data);return{count:1}}},$transaction:async(callback)=>{attempts++;if(attempts<=(options.conflicts??0))throw Object.assign(new Error("conflict"),{code:"P2034"});transactions++;try{return await callback(store)}finally{transactions--}}};
  const provider:RouteProvider={estimateLeg:async(origin,destination)=>{if(transactions)providerDuringTransaction=true;const value=Math.abs(destination.longitude-origin.longitude);return{distanceKm:value,durationMinutes:value}}};
  return{store,provider,stops,get providerDuringTransaction(){return providerDuringTransaction},get attempts(){return attempts}};
}
function app(state:ReturnType<typeof createStore>){return createApp({store:state.store as any,authenticate,now:()=>now,routeConfig:{assumedSpeedKmh:20,maxLateMinutes:5,maxStops:6},routeProvider:state.provider})}
describe("multi-stop routes",()=>{
  it("optimizes and persists a valid sequence with provider calls outside transactions",async()=>{const state=createStore();const response=await request(app(state)).post(`/api/v1/delivery-batches/${batchId}/optimize`).set("Authorization","Bearer ADMIN").send({});expect(response.status).toBe(200);expect(response.body.data.stops.map((stop:any)=>stop.orderNumber)).toEqual(["MED-A","MED-B","MED-B","MED-A"]);expect(state.providerDuringTransaction).toBe(false);expect(state.stops.every((stop)=>stop.sequence>0&&stop.estimatedArrivalAt instanceof Date)).toBe(true)});
  it("returns the saved route only to a rider through the ownership-scoped query",async()=>{const state=createStore();await request(app(state)).post(`/api/v1/delivery-batches/${batchId}/optimize`).set("Authorization","Bearer ADMIN").send({});const response=await request(app(state)).get(`/api/v1/delivery-batches/${batchId}/route/me`).set("Authorization","Bearer DELIVERY_PARTNER");expect(response.status).toBe(200);expect(response.body.data.stops).toHaveLength(4)});
  it("requires the correct roles and a valid batch id",async()=>{const state=createStore();const forbidden=await request(app(state)).post(`/api/v1/delivery-batches/${batchId}/optimize`).set("Authorization","Bearer DELIVERY_PARTNER").send({});const invalid=await request(app(state)).get("/api/v1/delivery-batches/bad/route/me").set("Authorization","Bearer DELIVERY_PARTNER");expect(forbidden.status).toBe(403);expect(invalid.status).toBe(400)});
  it("retries serializable persistence conflicts",async()=>{const state=createStore({conflicts:2});const response=await request(app(state)).post(`/api/v1/delivery-batches/${batchId}/optimize`).set("Authorization","Bearer ADMIN").send({});expect(response.status).toBe(200);expect(state.attempts).toBe(3)});
});
