# Build the training table (features + labels) from labels.csv and the raw NASA images.
# Usage: python build_training.py <folder with raw/ images> <out train.npz>
import sys,os,csv,cv2,numpy as np
sys.path.insert(0,os.path.dirname(__file__)); import features as F
CODE={'rock':'R','boulder':'B','outcrop':'O','rover_hardware':'H','not_obstacle':'N'}
root=sys.argv[1]; X=[];y=[];g=[];cache={}
for r in csv.DictReader(open(os.path.join(os.path.dirname(__file__),'labels.csv'))):
    k=r['image']
    if k not in cache: cache[k]=F.prep(cv2.imread(os.path.join(root,'raw',k)))
    X.append(F.feats(cache[k],[float(r[c]) for c in ('x1','y1','x2','y2')])); y.append(CODE[r['label']]); g.append(k.split('_')[2])
np.savez(sys.argv[2],X=np.array(X),y=np.array(y),g=np.array(g)); print(len(y),'labelled boxes')
