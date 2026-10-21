// Separate product family: never pass 3D letters to the neon-tube price/checkout API.
// Enable checkout only after approved 3D rules and authoritative backend pricing exist.
export function quote3D(){return Object.freeze({status:'placeholder',currency:'EUR',grossCents:null,version:null,purchaseEnabled:false});}
