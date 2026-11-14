# Builds the textures (cut from NASA Perseverance Mastcam-Z frames) and the colour profile of each
# obstacle class (from our labelled boxes) used by the HUD recogniser.
# Usage: python make_textures_and_profiles.py <folder with raw/> <labels.csv> <out project folder>
import sys,csv,glob,json,cv2,numpy as np,collections,os
root,labels,out=sys.argv[1],sys.argv[2],sys.argv[3]
rows=list(csv.DictReader(open(labels)))
def lab_mean(img):  # BGR uint8 -> CIE L*a*b* mean
    l=cv2.cvtColor(img,cv2.COLOR_BGR2LAB).astype(np.float32).reshape(-1,3)
    return [float(l[:,0].mean()*100/255), float(l[:,1].mean()-128), float(l[:,2].mean()-128)]
def crop_center(r,frac):
    im=cv2.imread(os.path.join(root,'raw',r['image']))
    x1,y1,x2,y2=[int(float(r[k])) for k in ('x1','y1','x2','y2')]
    s=int(min(x2-x1,y2-y1)*frac); cx,cy=(x1+x2)//2,(y1+y2)//2
    return im[cy-s//2:cy+s//2, cx-s//2:cx+s//2]
def seamless(t):
    n=t.shape[0]; r=np.roll(np.roll(t,n//2,0),n//2,1).astype(np.float32)
    y,x=np.mgrid[0:n,0:n]/(n-1); w=np.minimum(np.minimum(x,1-x),np.minimum(y,1-y))*2
    w=np.clip(w*2.2,0,1)[...,None]
    return (t.astype(np.float32)*w+r*(1-w)).astype(np.uint8)
# 1) class colour profiles from the labelled boxes (inner half of each box)
prof=collections.defaultdict(list)
for r in rows:
    if r['label']=='not_obstacle': continue
    c=crop_center(r,0.5)
    if c.size: prof[r['label']].append(lab_mean(c))
profiles={k:{'mean':np.mean(v,0).round(2).tolist(),'std':np.maximum(np.std(v,0),[4,1.2,2]).round(2).tolist(),'n':len(v)} for k,v in prof.items()}
# 2) textures
os.makedirs(os.path.join(out,'textures'),exist_ok=True)
texinfo={}
ROCK=[176,220,222,284,300]; OUTC=[207,238,250]
for name,ids,size in [('rock',ROCK,256),('outcrop',OUTC,256)]:
    for n,i in enumerate(ids):
        t=cv2.resize(crop_center(rows[i],0.55),(size,size),interpolation=cv2.INTER_AREA)
        t=seamless(t); f=f'textures/{name}_{n}.jpg'
        cv2.imwrite(os.path.join(out,f),t,[cv2.IMWRITE_JPEG_QUALITY,85]); texinfo[f]=lab_mean(t)
g=cv2.imread(glob.glob(os.path.join(root,'raw','ZL0_2024_0846622230_*EBY*'))[0])[150:950,100:900]
g=seamless(cv2.resize(g,(512,512),interpolation=cv2.INTER_AREA))
cv2.imwrite(os.path.join(out,'textures/ground.jpg'),g,[cv2.IMWRITE_JPEG_QUALITY,85]); texinfo['textures/ground.jpg']=lab_mean(g)
json.dump({'profiles':profiles,'textures':texinfo},open(os.path.join(out,'analysis','profiles.json'),'w'),indent=1)
for k,v in profiles.items(): print(k,v)
for k,v in texinfo.items(): print(k,[round(x,1) for x in v])
