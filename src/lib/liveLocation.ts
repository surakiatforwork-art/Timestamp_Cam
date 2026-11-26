import { useEffect, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { reverseGeocodeDetails } from './geocoding';
import type { Settings, LocationDetails } from '../types';

type Fix={lat:number|null;lng:number|null;address:string|null;details:LocationDetails|null;status:'waiting'|'ready'|'unavailable'};
const empty:Fix={lat:null,lng:null,address:null,details:null,status:'waiting'};
let current:Fix=empty;
let fixTimestamp=0;
const listeners=new Set<()=>void>();
const publish=(value:Fix)=>{current=value;for(const fn of listeners)fn();};
export const subscribeLiveLocation=(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn);};};
export function useLiveLocation(){return useSyncExternalStore(subscribeLiveLocation,()=>current);}
export function resolveActiveLocation(settings:Settings,fix=current){
    return settings.locationMode==='gps'?fix:{lat:settings.latitude,lng:settings.longitude,address:settings.cachedAddress,details:settings.locationDetails,status:'ready' as const};
}
export function snapshotLiveLocation(settings:Settings){
    if(!settings.locationEnabled||settings.locationMode!=='gps')return {};
    const fix=Date.now()-fixTimestamp<=60000?current:empty;
    return {locationLatitude:fix.lat,locationLongitude:fix.lng,locationAddress:fix.address,locationDetails:fix.details};
}
const distance=(a:{lat:number;lng:number},b:{lat:number;lng:number})=>Math.hypot((a.lat-b.lat)*111320,(a.lng-b.lng)*111320*Math.cos(a.lat*Math.PI/180));

// One foreground watcher, independent of the camera and rendering loop.
export function useLocationTracker(settings:Settings){
    const needsAddress=settings.showAddress||settings.showSubdistrict||settings.showDistrict||settings.showProvince;
    useEffect(()=>{
        if(!settings.locationEnabled||settings.locationMode!=='gps'){publish(empty);return;}
        let disposed=false,generation=0,watchId:string|undefined,webId:number|undefined;
        let lastQuery=0,anchor:{lat:number;lng:number}|null=null,lookupBusy=false;
        let retry:ReturnType<typeof setTimeout>|undefined;
        let lastFixAt=0,expiry:ReturnType<typeof setTimeout>|undefined;
        const stop=(clear=true)=>{
            generation++;clearTimeout(retry);clearTimeout(expiry);lookupBusy=false;
            if(clear){lastFixAt=0;fixTimestamp=0;anchor=null;lastQuery=0;}
            if(watchId!==undefined){void Geolocation.clearWatch({id:watchId}).catch(()=>{});watchId=undefined;}
            if(webId!==undefined){navigator.geolocation.clearWatch(webId);webId=undefined;}
            if(clear)publish(empty);
        };
        const lookup=(token:number)=>{
            if(disposed||token!==generation||document.hidden||!needsAddress||lookupBusy||current.lat===null||current.lng===null)return;
            const point={lat:current.lat,lng:current.lng};
            if(anchor&&distance(anchor,point)<50)return;
            const remaining=30000-(Date.now()-lastQuery);
            if(remaining>0){clearTimeout(retry);retry=setTimeout(()=>lookup(token),remaining);return;}
            lastQuery=Date.now();lookupBusy=true;
            void reverseGeocodeDetails(point.lat,point.lng).then(result=>{
                if(disposed||token!==generation||document.hidden)return;
                lookupBusy=false;
                if(current.lat===null||current.lng===null)return;
                if(result&&distance(point,{lat:current.lat,lng:current.lng})<50){
                    anchor=point;publish({...current,address:result.displayName,details:result.details});
                }else if(!anchor||distance(anchor,{lat:current.lat,lng:current.lng})>=50){
                    clearTimeout(retry);retry=setTimeout(()=>lookup(token),30000);
                }
            });
        };
        const receive=(pos:Pick<Position,'coords'|'timestamp'>,token:number)=>{
            if(disposed||token!==generation||document.hidden)return;
            const {latitude:lat,longitude:lng}=pos.coords;
            if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||Date.now()-pos.timestamp>60000||pos.timestamp<lastFixAt)return;
            lastFixAt=pos.timestamp;fixTimestamp=pos.timestamp;
            clearTimeout(expiry);expiry=setTimeout(()=>{
                if(token===generation){anchor=null;fixTimestamp=0;publish({...empty,status:'unavailable'});}
            },Math.max(1000,60000-(Date.now()-pos.timestamp)));
            const keep=anchor&&distance(anchor,{lat,lng})<50;
            const next:Fix={lat,lng,address:keep?current.address:null,details:keep?current.details:null,status:'ready'};
            if(next.lat!==current.lat||next.lng!==current.lng||next.address!==current.address||next.details!==current.details||current.status!=='ready')publish(next);
            lookup(token);
        };
        const fail=(token:number)=>{if(!disposed&&token===generation&&!document.hidden&&current.status!=='ready')publish({...empty,status:'unavailable'});};
        const start=async()=>{
            stop(false);if(disposed||document.hidden)return;
            const token=generation;
            if(Date.now()-fixTimestamp>60000){anchor=null;fixTimestamp=0;publish(empty);}
            else expiry=setTimeout(()=>{if(token===generation){anchor=null;fixTimestamp=0;publish({...empty,status:'unavailable'});}},Math.max(1,60000-(Date.now()-fixTimestamp)));
            try{
                if(Capacitor.isNativePlatform()){
                    const permission=await Geolocation.checkPermissions();
                    if(disposed||token!==generation)return;
                    if(permission.location!=='granted'&&permission.coarseLocation!=='granted'){fixTimestamp=0;publish({...empty,status:'unavailable'});return;}
                    const id=await Geolocation.watchPosition({enableHighAccuracy:true,timeout:15000,maximumAge:5000,minimumUpdateInterval:2000},(pos,err)=>{if(pos)receive(pos,token);else if(err)fail(token);});
                    if(disposed||token!==generation)void Geolocation.clearWatch({id}).catch(()=>{});else watchId=id;
                }else{
                    if(!navigator.geolocation){fail(token);return;}
                    const permission=await navigator.permissions.query({name:'geolocation'});
                    if(disposed||token!==generation)return;
                    if(permission.state!=='granted'){fixTimestamp=0;publish({...empty,status:'unavailable'});return;}
                    webId=navigator.geolocation.watchPosition(pos=>receive(pos,token),()=>fail(token),{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
                }
            }catch{fail(token);}
        };
        const visibility=()=>{if(document.hidden)stop(false);else void start();};
        const refresh=()=>{if(!document.hidden)void start();};
        void start();
        document.addEventListener('visibilitychange',visibility);
        window.addEventListener('timestamp-location-refresh',refresh);
        return ()=>{disposed=true;stop();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('timestamp-location-refresh',refresh);};
    },[settings.locationEnabled,settings.locationMode,needsAddress]);
}
