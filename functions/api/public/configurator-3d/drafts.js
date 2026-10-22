import {proxy3D} from '../../../_shared/configurator-3d-proxy.js';
export const onRequest=({request})=>proxy3D(request,'drafts');
