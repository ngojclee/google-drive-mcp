import express from 'express';
import { adminHtml } from '../.tmp-test/src/adminHtml.js';
import { ADMIN_ICON_SVG } from '../.tmp-test/src/adminIcon.js';
const app = express();
app.use(express.json());
app.get('/admin/', (_req,res)=>res.type('html').send(adminHtml.split('__NONCE__').join('local-preview')));
// Synthetic preview only: any nonempty demo key opens the mock inventory.
app.post('/admin/login', (req,res)=>req.body.key?res.cookie('preview-session','1',{httpOnly:true,sameSite:'strict'}).json({ok:true}):res.status(401).json({error:'admin_login_required'}));
app.post('/admin/logout', (_req,res)=>res.clearCookie('preview-session').json({ok:true}));
app.use('/admin/status',(req,res,next)=>(req.headers.cookie||'').split(';').some(c=>c.trim()==='preview-session=1')?next():res.status(401).json({error:'admin_login_required'}));
app.get('/admin/favicon.svg', (_req,res)=>res.type('image/svg+xml').send(ADMIN_ICON_SVG));
app.get('/admin/status', (_req,res)=>res.json({accounts:[{alias:'default',email:'demo@example.com',scopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/documents'],isDefault:true,hasRefreshToken:true}],files:[{kind:'oauth',path:'/config/gcp-oauth.keys.json',present:true,bytes:475},{kind:'tokens',path:'/config/tokens.json',present:true,bytes:826}],consent:null,access:{api:{configured:true,endpoint:'/mcp'},management:{source:'runtime',path:'/config/admin-key.json',createdAt:'2026-10-17T10:00:00Z',bootstrapIgnored:true}},settings:{resourcesDisabled:true,allowedHosts:'10.21.4.101,google-drive-mcp',callbackHost:'127.0.0.1'}}));
app.listen(17456,'127.0.0.1',()=>console.log('Synthetic preview: http://127.0.0.1:17456/admin/'));
