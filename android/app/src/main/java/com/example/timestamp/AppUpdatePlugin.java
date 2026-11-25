package com.example.timestamp;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name="AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final String REPO="surakiatforwork-art/Timestamp_Cam";
    private static final long MAX=100L*1024*1024;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private volatile Release selected;
    private File verified;
    private static class Release {
        String version,url,digest,notes; long size;
    }
    static int compareVersion(String a,String b) {
        if(a==null||b==null||!a.matches("v?[0-9]+(\\.[0-9]+){0,3}")||!b.matches("v?[0-9]+(\\.[0-9]+){0,3}"))
            throw new IllegalArgumentException("Invalid release version");
        String[] x=a.replaceFirst("^v","").split("\\."),y=b.replaceFirst("^v","").split("\\.");
        for(int i=0;i<Math.max(x.length,y.length);i++){
            int c=Long.compare(i<x.length?Long.parseLong(x[i]):0,i<y.length?Long.parseLong(y[i]):0);
            if(c!=0)return c;
        }
        return 0;
    }
    private PackageInfo installed(int flags)throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),flags);
    }
    private static HttpsURLConnection connection(String input)throws Exception{
        URL url=new URL(input);
        for(int i=0;i<6;i++){
            String host=url.getHost().toLowerCase(Locale.ROOT);
            if(!"https".equals(url.getProtocol()) || !(host.equals("api.github.com")||host.equals("github.com")||host.equals("release-assets.githubusercontent.com")||host.equals("objects.githubusercontent.com")))throw new IOException("Invalid update host");
            HttpsURLConnection c=(HttpsURLConnection)url.openConnection();
            c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent","TimestampCam-Updater");
            c.setRequestProperty("Accept","application/vnd.github+json");
            int status=c.getResponseCode();
            if(status==301||status==302||status==303||status==307||status==308){
                String next=c.getHeaderField("Location");c.disconnect();
                if(next==null)throw new IOException("Missing redirect");
                url=new URL(url,next);continue;
            }
            if(status!=200){c.disconnect();throw new IOException("HTTP "+status);}
            return c;
        }
        throw new IOException("Too many redirects");
    }
    private Release latest()throws Exception{
        HttpsURLConnection c=connection("https://api.github.com/repos/"+REPO+"/releases/latest");
        JSONObject json;
        try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buf=new byte[8192];int n;
            while((n=in.read(buf))!=-1){if(out.size()+n>1024*1024)throw new IOException("Response too large");out.write(buf,0,n);}
            json=new JSONObject(out.toString("UTF-8"));
        }finally{c.disconnect();}
        if(json.optBoolean("draft")||json.optBoolean("prerelease"))return null;
        String tag=json.getString("tag_name");
        if(compareVersion(tag,installed(0).versionName)<=0)return null;
        JSONArray assets=json.getJSONArray("assets");
        JSONObject asset=null;
        for(String name:new String[]{"app-release.apk","app-debug.apk"}){
            for(int i=0;i<assets.length();i++){
                JSONObject a=assets.getJSONObject(i);if(name.equals(a.optString("name"))){asset=a;break;}
            }
            if(asset!=null)break;
        }
        if(asset==null)throw new IOException("Release has no supported APK");
        Release r=new Release();r.version=tag.replaceFirst("^v","");r.url=asset.getString("browser_download_url");r.size=asset.getLong("size");
        r.digest=asset.isNull("digest")?"":asset.optString("digest","");r.notes=json.optString("body","");
        if(!r.url.equals("https://github.com/"+REPO+"/releases/download/"+tag+"/"+asset.getString("name"))||r.size<=0||r.size>MAX)throw new IOException("Invalid release asset");
        if(!r.digest.isEmpty()&&!r.digest.matches("sha256:[a-fA-F0-9]{64}"))throw new IOException("Invalid release digest");
        return r;
    }
    private void run(PluginCall call, Runnable job){
        if(!busy.compareAndSet(false,true)){call.reject("Update operation already running");return;}
        worker.execute(()->{try{job.run();}finally{busy.set(false);}});
    }
    @PluginMethod public void check(PluginCall call){
        run(call,()->{try{
            Release r=latest();selected=r;
            JSObject result=new JSObject();result.put("installed",installed(0).versionName);result.put("available",r!=null);
            if(r!=null){result.put("version",r.version);result.put("size",r.size);result.put("notes",r.notes);}
            call.resolve(result);
        }catch(Exception e){selected=null;call.reject("Check failed: "+e.getMessage());}});
    }
    private File dir()throws IOException{
        File d=new File(getContext().getCacheDir(),"updates");
        if(!d.isDirectory()&&!d.mkdirs())throw new IOException("Cannot create update directory");
        return d;
    }
    @SuppressWarnings("deprecation")
    private static long code(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo p){
        Signature[] signatures=Build.VERSION.SDK_INT>=28?(p.signingInfo==null?null:p.signingInfo.getApkContentsSigners()):p.signatures;
        Set<String> result=new HashSet<>();
        if(signatures!=null)for(Signature signature:signatures)result.add(signature.toCharsString());
        return result;
    }
    @SuppressWarnings("deprecation")
    private void validate(File file,Release r)throws Exception{
        int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo incoming=getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),flags),local=installed(flags);
        if(incoming==null||!getContext().getPackageName().equals(incoming.packageName)||!r.version.equals(incoming.versionName)||code(incoming)<=code(local))throw new IOException("APK package or version does not match");
        Set<String> actual=signers(incoming);
        if(actual.isEmpty()||!actual.equals(signers(local)))throw new IOException("APK signing certificate does not match");
    }
    @PluginMethod public void download(PluginCall call){
        run(call,()->{
            File part=null;HttpsURLConnection c=null;
            try{
                Release r=selected;if(r==null)throw new IOException("Check for an update first");
                verified=null;File folder=dir(),apk=new File(folder,"update.apk");part=new File(folder,"update-part.apk");
                part.delete();apk.delete();
                c=connection(r.url);
                MessageDigest hash=MessageDigest.getInstance("SHA-256");
                long count=0,last=0;byte[] buffer=new byte[32768];
                try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(part)){
                    int n;
                    while((n=in.read(buffer))!=-1){
                        count+=n;if(count>r.size||count>MAX)throw new IOException("APK size mismatch");
                        hash.update(buffer,0,n);out.write(buffer,0,n);
                        long now=android.os.SystemClock.elapsedRealtime();
                        if(now-last>=120||count==r.size){JSObject progress=new JSObject();progress.put("received",count);progress.put("total",r.size);notifyListeners("progress",progress);last=now;}
                    }
                }
                if(count!=r.size)throw new IOException("Incomplete APK");
                StringBuilder digest=new StringBuilder();for(byte b:hash.digest())digest.append(String.format(Locale.ROOT,"%02x",b&255));
                if(!r.digest.isEmpty()&&!r.digest.equalsIgnoreCase("sha256:"+digest))throw new IOException("SHA-256 mismatch");
                validate(part,r);
                if(!part.renameTo(apk))throw new IOException("Cannot save verified APK");
                verified=apk;call.resolve();
            }catch(Exception e){call.reject("Download failed: "+e.getMessage());}
            finally{if(c!=null)c.disconnect();if(part!=null)part.delete();}
        });
    }
    @PluginMethod public void install(PluginCall call){
        run(call,()->{try{
            File apk=verified;Release r=selected;
            if(apk==null||r==null||!apk.isFile()||apk.length()!=r.size)throw new IOException("Download the update first");
            validate(apk,r);
            if(!getContext().getPackageManager().canRequestPackageInstalls()){
                getActivity().runOnUiThread(()->{try{
                    getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName())));
                    JSObject result=new JSObject();result.put("permissionRequired",true);call.resolve(result);
                }catch(Exception e){call.reject("Cannot open install permission");}});
                return;
            }
            Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",apk);
            getActivity().runOnUiThread(()->{try{
                Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(intent);
                JSObject result=new JSObject();result.put("permissionRequired",false);call.resolve(result);
            }catch(Exception e){call.reject("Cannot open Android installer");}});
        }catch(Exception e){call.reject("Install failed: "+e.getMessage());}});
    }
    @Override protected void handleOnDestroy(){worker.shutdownNow();}
}
