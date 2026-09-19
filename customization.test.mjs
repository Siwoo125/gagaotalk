import test from 'node:test';
import assert from 'node:assert/strict';
import {safeAvatar,safeColor,inkFor,resizeAvatar} from './customization.js';
test('profile image sources reject active content and oversized embedded data',()=>{
 assert.equal(safeAvatar('javascript:alert(1)'),null);
 assert.equal(safeAvatar('data:image/svg+xml;base64,AAAA'),null);
 assert.equal(safeAvatar('data:image/jpeg;base64,'+'A'.repeat(90000)),null);
 assert.equal(safeAvatar('data:image/jpeg;base64,AAAA'),'data:image/jpeg;base64,AAAA');
 assert.equal(safeAvatar('https://example.com/photo.jpg'),'https://example.com/photo.jpg');
});
test('cosmetic colors stay valid and dark bubbles get legible text',()=>{
 assert.equal(safeColor('red;display:none'),null);
 assert.equal(safeColor('#34D399'),'#34D399');
 assert.equal(inkFor('#4C1D95'),'#ffffff');
 assert.equal(inkFor('#FDE68A'),'#191919');
});
test('photo validation rejects unsupported types and large files before decoding',async()=>{
 await assert.rejects(resizeAvatar({type:'image/svg+xml',size:10}),/JPG/);
 await assert.rejects(resizeAvatar({type:'image/jpeg',size:11*1024*1024}),/10MB/);
});
