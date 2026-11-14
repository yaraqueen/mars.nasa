# Obstacle proposals on Mastcam-Z frames: rocks are brighter/darker and more textured than the sand around them.
import cv2, numpy as np, json, sys, glob, os
W=824  # working width (half resolution)
def proposals(path):
    im=cv2.imread(path); H0,W0=im.shape[:2]; s=W/W0
    im=cv2.resize(im,(W,int(H0*s)),interpolation=cv2.INTER_AREA)
    g=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY).astype(np.float32)
    # frames carry a black strip at the edges: keep it out of every mask
    valid=cv2.erode((g>18).astype(np.uint8),np.ones((15,15),np.uint8))
    bg=cv2.GaussianBlur(g,(0,0),25)
    d=g-bg
    m1=cv2.GaussianBlur(g,(0,0),3); m2=cv2.GaussianBlur(g*g,(0,0),3)
    tex=np.sqrt(np.maximum(m2-m1*m1,0))
    t_tex=np.percentile(tex,80)*1.25
    mask=(((tex>t_tex)|(np.abs(d)>max(14,np.percentile(np.abs(d),97))))&(valid>0)).astype(np.uint8)
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((5,5),np.uint8))
    n,lab,st,cen=cv2.connectedComponentsWithStats(mask)
    small=[]
    for i in range(1,n):
        x,y,w,h,a=st[i]
        if a<120 or w<12 or h<12: continue
        small.append([x,y,x+w,y+h,a])
    # large objects (big rocks, outcrops, rover parts): colour far from the sand colour of this frame
    lab_=cv2.cvtColor(cv2.GaussianBlur(im,(0,0),4),cv2.COLOR_BGR2LAB).astype(np.float32)
    sand=np.median(lab_[valid>0],axis=0)
    de=np.sqrt(((lab_-sand)**2).sum(2))
    big=((de>max(16,np.percentile(de[valid>0],75)*1.7))&(valid>0)).astype(np.uint8)
    big=cv2.morphologyEx(big,cv2.MORPH_OPEN,np.ones((9,9),np.uint8))
    big=cv2.morphologyEx(big,cv2.MORPH_CLOSE,np.ones((15,15),np.uint8))
    n2,_,st2,_=cv2.connectedComponentsWithStats(big)
    large=[]
    for i in range(1,n2):
        x,y,w,h,a=st2[i]
        if a<0.006*W*im.shape[0]: continue
        large.append([x,y,x+w,y+h,a])
    def inside(b,L):
        ix=max(0,min(b[2],L[2])-max(b[0],L[0]))*max(0,min(b[3],L[3])-max(b[1],L[1]))
        return ix>0.6*(b[2]-b[0])*(b[3]-b[1])
    keep=[b for b in small if not any(inside(b,L) for L in large)]
    out=[[b[0]/s,b[1]/s,b[2]/s,b[3]/s,int(b[4]/(s*s))] for b in large+keep]
    return out,(W0,H0)
if __name__=='__main__':
    res={}
    for f in sorted(glob.glob(sys.argv[1])):
        p,sz=proposals(f); res[os.path.basename(f)]={'size':sz,'boxes':p}
        print(os.path.basename(f)[:30],len(p))
    json.dump(res,open(sys.argv[2],'w'))

def merge(boxes, W0):
    """Drop tiny pebbles and merge boxes that mostly overlap (one obstacle split in pieces)."""
    bs=[list(b) for b in boxes if max(b[2]-b[0],b[3]-b[1])>=0.03*W0]
    changed=True
    while changed:
        changed=False
        for i in range(len(bs)):
            for j in range(i+1,len(bs)):
                a,b=bs[i],bs[j]
                ix=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
                sa=(a[2]-a[0])*(a[3]-a[1]); sb=(b[2]-b[0])*(b[3]-b[1])
                if ix>0.35*min(sa,sb):
                    bs[i]=[min(a[0],b[0]),min(a[1],b[1]),max(a[2],b[2]),max(a[3],b[3]),a[4]+b[4]]
                    del bs[j]; changed=True; break
            if changed: break
    return bs
