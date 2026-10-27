import catalog from "./ops-catalog.generated.json" with { type: "json" };
import { GatewayError } from "./errors.js";

export interface OpsOperation {
 id: string; path: string; method: string; pathParameters: string[];
 queryParameters: string[]; bodyFields: string[]; actionValues: string[];
 requestTypes: string[]; inputContracts?: unknown[]; source: string; readOnly: boolean; notes: string;
}
export const OPS_OPERATIONS: OpsOperation[] = catalog.operations;
export const OPS_COVERAGE = catalog.coverage;
export const OPS_CONTRACT_DEPENDENCIES = catalog.contractDependencies;
export function opsOperation(id: string) {
 const entry = OPS_OPERATIONS.find(x => x.id === id);
 if (!entry) throw new GatewayError("unknown_ops_operation", "Unbekannte OPS-Funktion.", 422);
 return entry;
}
export function opsRequest(id: string, pathParameters: Record<string,string> = {}, query: Record<string,string|number|boolean> = {}) {
 const operation = opsOperation(id);
 if (Object.keys(pathParameters).some(k=>!operation.pathParameters.includes(k)))
  throw new GatewayError("invalid_path_parameters","Unbekannte Pfadparameter.",422);
 let path = operation.path;
 for (const key of operation.pathParameters) {
  const value=pathParameters[key];
  if (!value || value.length>160 || /[\\/\x00-\x1f]/.test(value) || value==="." || value==="..")
   throw new GatewayError("invalid_path_parameters","Fehlende oder ungültige Objekt-ID.",422);
  path=path.replace("["+key+"]",encodeURIComponent(value));
 }
 const params=new URLSearchParams();
 for (const [key,value] of Object.entries(query)) {
  if (!operation.queryParameters.includes(key)) throw new GatewayError("invalid_query_parameter","Unbekannter Abfrageparameter: "+key,422);
  params.set(key,String(value));
 }
 return {operation,path:path+(params.size?"?"+params.toString():"")};
}
