import { NextRequest } from "next/server";
import { POST as handlePricePredictionPost } from "@/app/api/ops/customer-records/price-predictions/route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handlePricePredictionPost(request);
}
