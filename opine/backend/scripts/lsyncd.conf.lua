-- lsyncd Configuration for Opine Backend Sync
-- Syncs code from PRIMARY (172.31.43.71) to SECONDARY (172.31.47.152)
-- ONE-WAY SYNC ONLY: PRIMARY → SECONDARY

settings {
    logfile = "/var/log/lsyncd/lsyncd.log",
    statusFile = "/var/log/lsyncd/lsyncd.status",
    statusInterval = 10,
    nodaemon = false,
    inotifyMode = "Modify",
    maxProcesses = 4,
    maxDelays = 20
}

-- Sync backend code directory
sync {
    default.rsync,
    source = "/var/www/opine/backend/",
    target = "ubuntu@3.109.82.159:/var/www/opine/backend/",
    rsync = {
        archive = true,
        compress = true,
        perms = true,
        owner = true,
        group = true,
        _extra = {
            "--rsh=/usr/bin/ssh -i /var/www/MyLogos/Convergent-New.pem -o StrictHostKeyChecking=no",
            "--no-whole-file",
            "--checksum"
        }
    },
    exclude = {
        -- Environment files (NEVER sync - each server has its own)
        ".env",
        ".env.*",
        "*.env",
        "*.env.backup.*",
        
        -- Dependencies (will be installed on secondary if needed)
        "node_modules/",
        "package-lock.json",
        
        -- Logs (each server has its own logs)
        "logs/",
        "*.log",
        "npm-debug.log*",
        "yarn-debug.log*",
        "yarn-error.log*",
        "pm2.log",
        
        -- Uploads and user-generated content
        "uploads/",
        "temp/",
        "tmp/",
        "*.tmp",
        "*.bak",
        
        -- Database backups
        "database_backups/",
        "temp_prod_dump/",
        
        -- Cache and build files
        ".cache/",
        "dist/",
        "build/",
        ".next/",
        
        -- IDE files
        ".vscode/",
        ".idea/",
        "*.swp",
        "*.swo",
        
        -- OS files
        ".DS_Store",
        "Thumbs.db",
        
        -- Git (if present, but usually not in production)
        ".git/",
        ".gitignore",
        
        -- PM2 ecosystem and runtime files
        ".pm2/",
        "ecosystem.config.js",  -- Each server might have different PM2 config
        
        -- Generated CSV files
        "generated-csvs/",
        
        -- Specific script exclusions (if any)
        "*_mock_audio*.js",
        "check_*.js",
        "fix_*.js",
        "restore_*.js",
        "find_*.js"
    },
    delay = 3,  -- Wait 3 seconds before syncing (batch multiple changes)
    init = false  -- Don't sync on startup (use separate initial sync)
}

-- Note: Post-sync actions can be added via rsync hooks or separate monitoring
-- For now, we'll handle PM2 restart via a separate mechanism if needed

