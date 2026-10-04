"use client";
import {useEffect,useState} from 'react';
import {Download,Check} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export default function InstallApp(){
 const[prompt,setPrompt]=useState<InstallPrompt|null>(null);const[installed,setInstalled]=useState(false);const[help,setHelp]=useState(false);
 useEffect(()=>{
  const check=()=>setInstalled(window.matchMedia('(display-mode: standalone)').matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);
  const capture=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt)};
  const done=()=>{setInstalled(true);setPrompt(null)};
  check();window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',done);
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  return()=>{window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',done)};
 },[]);
 const install=async()=>{if(!prompt){setHelp(true);return}try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')setInstalled(true);setPrompt(null)}catch{setHelp(true)}};
 return <><button className="ghost-btn small-btn install-button" onClick={install} disabled={installed}>{installed?<Check size={16}/>:<Download size={16}/>}<span>{installed?'Installée':'Installer l’app'}</span></button><Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogHeader><DialogTitle>Afterwatch sur ton écran d’accueil</DialogTitle><DialogDescription>Ouvre le site dans ton navigateur habituel pour l’installer.</DialogDescription></DialogHeader><div className="install-help"><p><strong>iPhone / iPad :</strong> dans Safari, appuie sur Partager, puis « Sur l’écran d’accueil ».</p><p><strong>Android :</strong> dans Chrome, ouvre le menu ⋮, puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p><p><strong>Windows / Mac :</strong> cherche l’icône d’installation dans la barre d’adresse de Chrome ou Edge. Dans Safari sur Mac, utilise « Fichier → Ajouter au Dock ».</p><p className="form-hint">Tu retrouves la même app et la même collection. Internet et ta connexion au site restent nécessaires. Les rappels fonctionnent tant que l’app est ouverte.</p></div></DialogContent></Dialog></>;
}
