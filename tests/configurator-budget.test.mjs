import test from 'node:test';
import assert from 'node:assert/strict';
import {selectBudgetQuotes} from '../deploy/configurator/budget-advisor.js';
const quote=(font,gross,status='calculated')=>({design:{fontId:font},gross,price:{status}});
test('budget suggestions exclude unavailable and over-budget quotes',()=>{
 const exact=quote('Exact',400),cheap=quote('Cheap',250);
 assert.deepEqual(selectBudgetQuotes([quote('Too expensive',400.05),quote('Invalid',200,'below-minimum'),quote('Pending',undefined,'pending'),exact,cheap],400),[cheap,exact]);
 assert.deepEqual(selectBudgetQuotes([cheap,exact],10),[]);
});
test('three suggestions retain real low, middle and high price bands',()=>{
 const values=[500,250,400,300,350].map((p,i)=>quote(String(i),p));
 assert.deepEqual(selectBudgetQuotes(values,500).map(q=>q.gross),[250,350,500]);
});
test('equal prices remain equal and selection never invents additional quotes',()=>{
 const values=['A','B','C'].map(id=>quote(id,327.35));
 assert.deepEqual(selectBudgetQuotes(values,400),values);
 assert.deepEqual(selectBudgetQuotes(values.slice(0,1),400),values.slice(0,1));
});
