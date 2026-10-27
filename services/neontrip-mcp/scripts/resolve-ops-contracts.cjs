// Resolve the immediate business-helper input types with the repository's TypeScript compiler.
const ts=require("typescript"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"../../..");
const config=ts.readConfigFile(root+"/tsconfig.json",ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker();
const file=root+"/services/neontrip-mcp/src/ops-catalog.generated.json";
const catalog=JSON.parse(fs.readFileSync(file,"utf8"));
const dependencies=new Map();
for(const row of catalog.coverage){
 const source=program.getSourceFile(root+"/"+row.source);
 if(!source)throw new Error("Missing route "+row.source);
 const contracts=[],inputTypes=[],visitedTypes=new Set();
 function referencedTypes(node,depth=0){
  if(!node||depth>12)return;
  if(ts.isTypeReferenceNode(node)){
   let sym=checker.getSymbolAtLocation(node.typeName);
   if(sym?.flags&ts.SymbolFlags.Alias)sym=checker.getAliasedSymbol(sym);
   for(const decl of sym?.declarations||[]){
    const sourcePath=decl.getSourceFile().fileName;
    if((!sourcePath.startsWith(root+"/src/lib/") && sourcePath!==source.fileName)||!(ts.isTypeAliasDeclaration(decl)||ts.isInterfaceDeclaration(decl)))continue;
    const key=sourcePath+":"+decl.pos;
    if(visitedTypes.has(key))continue;
    if(visitedTypes.size>=120)throw new Error("Input contract needs explicit review: "+row.source);
    visitedTypes.add(key);
    if(/\/(?:auth|voice-copilot-api|company-brain-api|company-brain-access)\.ts$/.test(sourcePath))continue;
    const relative=path.relative(root,sourcePath);
    dependencies.set(relative,crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex"));
    inputTypes.push({name:decl.name.text,type:decl.getText(),source:relative});
    referencedTypes(decl,depth+1);
   }
  }
  ts.forEachChild(node,child=>referencedTypes(child,depth+1));
 }
 for(const stmt of source.statements){
  if((ts.isTypeAliasDeclaration(stmt)||ts.isInterfaceDeclaration(stmt)) && /(?:Input|Body|ActionKey)$/.test(stmt.name.text)){
   contracts.push({name:stmt.name.text,type:checker.typeToString(checker.getTypeAtLocation(stmt),stmt,ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.InTypeAlias),source:row.source});
   referencedTypes(stmt);
  }
  if(!ts.isImportDeclaration(stmt)||!stmt.importClause?.namedBindings||!ts.isNamedImports(stmt.importClause.namedBindings))continue;
  for(const binding of stmt.importClause.namedBindings.elements){
   let symbol=checker.getSymbolAtLocation(binding.name);
   if(!symbol)continue;
   if(symbol.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
   for(const declaration of symbol.declarations||[]){
    const sourcePath=declaration.getSourceFile().fileName;
    if(!sourcePath.startsWith(root+"/src/lib/"))continue;
    if(/\/(?:auth|voice-copilot-api|company-brain-api|company-brain-access)\.ts$/.test(sourcePath))continue;
    const relative=path.relative(root,sourcePath);
    dependencies.set(relative,crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex"));
    if(ts.isTypeAliasDeclaration(declaration)||ts.isInterfaceDeclaration(declaration)){
     contracts.push({name:binding.name.text,type:declaration.getText(),source:relative});
     referencedTypes(declaration);
    } else if(ts.isFunctionDeclaration(declaration)){
     for(const param of declaration.parameters)referencedTypes(param.type);
     const signature=checker.getSignatureFromDeclaration(declaration);
     if(!signature)continue;
     const parameters=signature.parameters.map(p=>{
      const decl=p.valueDeclaration||declaration;
      return p.name+": "+checker.typeToString(checker.getTypeOfSymbolAtLocation(p,decl),decl,ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.InTypeAlias);
     });
     if(parameters.length)contracts.push({name:binding.name.text,parameters,source:relative});
    }
   }
  }
 }
 for(const op of catalog.operations.filter(o=>o.source===row.source)){op.inputContracts=contracts;op.inputTypes=inputTypes;}
}
const overrides=JSON.parse(fs.readFileSync(root+"/services/neontrip-mcp/src/ops-contracts.json","utf8"));
for(const op of catalog.operations)if(overrides[op.id])Object.assign(op,overrides[op.id]);
catalog.contractDependencies=[...dependencies].map(([source,sha256])=>({source,sha256}));
fs.writeFileSync(file,JSON.stringify(catalog,null,2)+"\n");
console.log("Resolved immediate contracts; tracked "+dependencies.size+" helper files.");
