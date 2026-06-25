const fs = require('fs');
const files = [
  'src/components/ModsView.tsx',
  'src/components/BackupsView.tsx',
  'src/components/TeamView.tsx',
  'src/components/AuditLogsView.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // Fix the nested div that was created
  content = content.replace(
    '<div className="pt-4 pb-2 px-3">\n                          <Link \n              href="/dashboard/marketplace"',
    '<Link \n              href="/dashboard/marketplace"'
  );

  content = content.replace(
    '            </Link>\n\n            <div className="pt-4 pb-2 px-3">\n              <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider">Features</span>\n            </div>\n            </div>',
    '            </Link>\n\n            <div className="pt-4 pb-2 px-3">\n              <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider">Features</span>\n            </div>'
  );

  fs.writeFileSync(file, content);
});
