# Hand-crafted appearance features for one obstacle box (inside vs. the sand ring around it).
import cv2, numpy as np
NAMES=['w','h','area','aspect','border','L','a','b','Lstd','dL','da','db','chroma_in','chroma_ring',
       'grad_in','grad_ratio','lap_var','bright_frac','dark_frac','edge_den','sat_in','sat_ring','sharp_ratio']
def prep(img):
    lab=cv2.cvtColor(img,cv2.COLOR_BGR2LAB).astype(np.float32)
    g=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
    gx=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(g,cv2.CV_32F,0,1,ksize=3)
    grad=np.sqrt(gx*gx+gy*gy)
    lap=cv2.Laplacian(g,cv2.CV_32F)
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV).astype(np.float32)
    edges=cv2.Canny(g,60,140)
    return dict(lab=lab,g=g,grad=grad,lap=lap,hsv=hsv,edges=edges,H=img.shape[0],W=img.shape[1])
def feats(P,b):
    H,W=P['H'],P['W']; x1,y1,x2,y2=[int(round(v)) for v in b[:4]]
    x1,y1=max(0,x1),max(0,y1); x2,y2=min(W,max(x2,x1+2)),min(H,max(y2,y1+2))
    bw,bh=x2-x1,y2-y1; pw,ph=max(4,bw//3),max(4,bh//3)
    X1,Y1,X2,Y2=max(0,x1-pw),max(0,y1-ph),min(W,x2+pw),min(H,y2+ph)
    ring=np.ones((Y2-Y1,X2-X1),bool); ring[y1-Y1:y2-Y1,x1-X1:x2-X1]=False
    def inn(a): return a[y1:y2,x1:x2]
    def rng(a): r=a[Y1:Y2,X1:X2]; return r[ring] if ring.any() else r.reshape(-1,*r.shape[2:])
    Li,ai,bi=[inn(P['lab'][...,k]) for k in range(3)]; Lr,ar,br=[rng(P['lab'][...,k]) for k in range(3)]
    ci=np.sqrt((ai-128)**2+(bi-128)**2).mean(); cr=np.sqrt((ar-128)**2+(br-128)**2).mean()
    gi=inn(P['grad']).mean(); gr=rng(P['grad']).mean()+1e-3
    lv=inn(P['lap']).var(); lr=rng(P['lap']).var()+1e-3
    return [bw/W,bh/H,bw*bh/(W*H),bw/max(bh,1),float(x1<=2 or y1<=2 or x2>=W-2 or y2>=H-2),
            Li.mean(),ai.mean(),bi.mean(),Li.std(),Li.mean()-Lr.mean(),ai.mean()-ar.mean(),bi.mean()-br.mean(),ci,cr,
            gi,gi/gr,np.log1p(lv),(Li>200).mean(),(Li<70).mean(),(inn(P['edges'])>0).mean(),
            inn(P['hsv'][...,1]).mean(),rng(P['hsv'][...,1]).mean(),np.log1p(lv)-np.log1p(lr)]
