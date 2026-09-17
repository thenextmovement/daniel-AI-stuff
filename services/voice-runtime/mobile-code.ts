import {createHash} from "node:crypto";
export function mobileCodeHash(id:string,code:string) {
 return createHash("sha256").update("neontrip:mobile:"+id+":"+code).digest("hex");
}
