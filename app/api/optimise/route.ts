import {NextResponse} from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(){
  return NextResponse.json({
    connected:false,
    diagnostic:true,
    error:"API route is reachable; optimiser engine is being isolated while deployment is repaired."
  });
}
