import {requireVoiceUuid} from "./voice-platform-contract";
export function mobileLinkInput(value:unknown) {
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("mobile_input_invalid");
 const input=value as Record<string,unknown>;
 const keys:Record<string,string[]>={start:["action","id","phone","code"],cancel:["action","id"],unlink:["action","id"]};
 if(typeof input.action!=="string"||!Object.hasOwn(keys,input.action)||Object.keys(input).some(k=>!keys[input.action as string].includes(k)))throw Error("mobile_input_invalid");
 const id=requireVoiceUuid(input.id,"Handy-Einrichtung");
 if(input.action!=="start")return {action:input.action,id};
 if(typeof input.phone!=="string"||!/^[+0-9 ()/-]{7,35}$/.test(input.phone)||typeof input.code!=="string"||!/^\d{6}$/.test(input.code))throw Error("mobile_input_invalid");
 let phone=input.phone.replace(/[ ()/-]/g,"");
 if(phone.startsWith("0049"))phone="+49"+phone.slice(4);
 else if(phone.startsWith("00"))phone="+"+phone.slice(2);
 else if(phone.startsWith("0"))phone="+49"+phone.slice(1);
 if(!/^[+][1-9][0-9]{6,14}$/.test(phone))throw Error("mobile_input_invalid");
 return {action:input.action,id,phone,code:input.code};
}
