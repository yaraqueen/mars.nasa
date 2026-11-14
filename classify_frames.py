# Classify every obstacle proposal in every Mastcam-Z frame with an ExtraTrees model.
# Each pointing is predicted by a model that never saw that pointing's labels (leave-one-pointing-out).
import sys,json,glob,os,cv2,numpy as np
sys.path.insert(0,os.path.dirname(__file__)); import features as F
from sklearn.ensemble import ExtraTreesClassifier
ROOT=sys.argv[1]
d=np.load(ROOT+'/train.npz'); X,y,g=d['X'],d['y'],d['g']
res=json.load(open(ROOT+'/prop_all.json'))
NAMES={'R':'ROCK','B':'BOULDER','O':'OUTCROP','H':'ROVER HARDWARE'}
RISK={'ROCK':1,'BOULDER':2,'OUTCROP':2,'ROVER HARDWARE':0,'UNKNOWN':1}
KNOWN_THR,NOT_OBST_THR=0.5,0.4
models={}
def model_for(sc):
    if sc not in models:
        m=ExtraTreesClassifier(400,min_samples_leaf=2,class_weight='balanced',random_state=0)
        k=g!=sc; models[sc]=m.fit(X[k],y[k])
    return models[sc]
out=[]; stats={'kept':0,'unknown':0,'dropped':0}
frames=sorted([k for k in res if k.startswith('Z')],key=lambda k:(k.split('_')[2],k[:3]))
for k in frames:
    sc=k.split('_')[2]; W,H=res[k]['size']; P=F.prep(cv2.imread(ROOT+'/raw/'+k)); m=model_for(sc)
    dets=[]
    for b in res[k]['boxes']:
        p=dict(zip(m.classes_,m.predict_proba([F.feats(P,b)])[0]))
        if p.get('N',0)>=NOT_OBST_THR: stats['dropped']+=1; continue
        best=max((c for c in NAMES),key=lambda c:p.get(c,0)); conf=p.get(best,0)
        name=NAMES[best] if conf>=KNOWN_THR else 'UNKNOWN'
        stats['unknown' if name=='UNKNOWN' else 'kept']+=1
        c2=round(float(conf),2)
        if name=='UNKNOWN': c2=min(c2,0.49)  # never show 50% on an UNKNOWN
        dets.append({'cls':name,'conf':c2,'risk':RISK[name],
                     'box':[round(b[0]/W,4),round(b[1]/H,4),round(b[2]/W,4),round(b[3]/H,4)]})
    dets.sort(key=lambda d:(-d['risk'],-(d['box'][2]-d['box'][0])*(d['box'][3]-d['box'][1])))
    out.append({'file':k,'camera':'Mastcam-Z '+('left' if k.startswith('ZL0') else 'right'),'sol':int(k.split('_')[1]),'sclk':sc,'detections':dets})
for k in sorted(kk for kk in res if kk.startswith('LRF')):
    out.append({'file':k,'camera':'SuperCam RMI','sol':int(k.split('_')[1]),'sclk':k.split('_')[2],'detections':None})
json.dump(out,open(sys.argv[2],'w'))
print(len(out),'frames',stats)
