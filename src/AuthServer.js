/**
 * Authentication Server for Google Meet MCP
 * Automatically handles OAuth flow when tokens are missing or invalid
 */

import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import { google } from 'googleapis';
import open from 'open';

export class AuthServer {
  constructor(credentialsPath, tokenPath) {
    this.credentialsPath = credentialsPath;
    this.tokenPath = tokenPath;
    this.server = null;
    this.oAuth2Client = null;
    this.authCompletedSuccessfully = false;
    this.activeConnections = new Set();
  }

  /**
   * Check if valid tokens exist
   */
  async hasValidTokens() {
    try {
      const tokenData = await fs.readFile(this.tokenPath, 'utf8');
      const tokens = JSON.parse(tokenData);
      
      // Basic validation - check if required fields exist
      if (!tokens.access_token || !tokens.refresh_token) {
        return false;
      }
      
      // Check if token is expired
      if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
        // Try to refresh the token
        try {
          const credentials = await this.loadCredentials();
          const oAuth2Client = this.createOAuth2Client(credentials, 'http://localhost:3000/oauth2callback');
          oAuth2Client.setCredentials(tokens);
          
          const { credentials: newCredentials } = await oAuth2Client.refreshToken(tokens.refresh_token);
          await this.saveTokens(newCredentials);
          return true;
        } catch (error) {
          // Refresh failed
          return false;
        }
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load OAuth credentials from file
   */
  async loadCredentials() {
    try {
      const credentials = JSON.parse(await fs.readFile(this.credentialsPath, 'utf8'));
      
      // Support both web and installed app credential formats
      let clientConfig;
      if (credentials.web) {
        clientConfig = credentials.web;
      } else if (credentials.installed) {
        clientConfig = credentials.installed;
      } else {
        throw new Error('無效的憑證檔案格式');
      }
      
      return clientConfig;
    } catch (error) {
      throw new Error(`載入憑證失敗：${error.message}`);
    }
  }

  /**
   * Create OAuth2 client
   */
  createOAuth2Client(credentials, redirectUri) {
    const { client_id, client_secret } = credentials;
    return new google.auth.OAuth2(client_id, client_secret, redirectUri);
  }

  /**
   * Save tokens to file
   */
  async saveTokens(tokens) {
    try {
      // Ensure token directory exists
      const tokenDir = path.dirname(this.tokenPath);
      await fs.mkdir(tokenDir, { recursive: true });
      
      await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2));
    } catch (error) {
      throw new Error(`儲存 token 失敗：${error.message}`);
    }
  }

  /**
   * Create HTTP server for OAuth callback
   */
  createServer() {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      
      if (url.pathname === '/') {
        // Root route - show auth link
        const scopes = [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.readonly'
        ];
        
        const authUrl = this.oAuth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: scopes,
          prompt: 'consent'
        });

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>Google Meet MCP 認證</title>
    <meta charset="utf-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
        }
        .container {
            text-align: center;
            padding: 3em;
            background-color: #fff;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            max-width: 500px;
            width: 100%;
        }
        h1 {
            color: #333;
            margin-bottom: 1em;
        }
        .auth-button {
            display: inline-block;
            background: #4285f4;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            transition: background 0.2s;
            margin: 1em 0;
        }
        .auth-button:hover {
            background: #3367d6;
        }
        .info {
            background: #e3f2fd;
            padding: 1em;
            border-radius: 6px;
            margin: 1em 0;
            color: #1565c0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Google Meet MCP 認證</h1>
        <div class="info">
            <p><strong>自動認證流程已啟動</strong></p>
            <p>點擊下方按鈕完成 Google 授權</p>
        </div>
        <a href="${authUrl}" class="auth-button">🚀 使用 Google 帳號授權</a>
        <p style="color: #666; font-size: 0.9em; margin-top: 2em;">
            授權完成後，您可以關閉此視窗<br>
            服務器將自動繼續啟動
        </p>
    </div>
</body>
</html>
        `);
      } else if (url.pathname === '/oauth2callback') {
        // OAuth callback route
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>認證失敗</title>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { background: white; padding: 2em; border-radius: 8px; display: inline-block; }
        h1 { color: #d32f2f; }
    </style>
</head>
<body>
    <div class="container">
        <h1>❌ 授權失敗</h1>
        <p>錯誤：${error}</p>
        <p>請關閉此視窗並重新嘗試。</p>
    </div>
</body>
</html>
          `);
          return;
        }
        
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('授權碼缺失');
          return;
        }
        
        try {
          const { tokens } = await this.oAuth2Client.getToken(code);
          await this.saveTokens(tokens);
          this.authCompletedSuccessfully = true;
          
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>認證成功</title>
    <meta charset="utf-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 3em;
            background-color: #fff;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            max-width: 500px;
        }
        h1 { color: #4caf50; }
        .success-icon { font-size: 4em; margin: 0.5em 0; }
        .token-path {
            background: #f5f5f5;
            padding: 1em;
            border-radius: 6px;
            font-family: monospace;
            word-break: break-all;
            margin: 1em 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✅</div>
        <h1>認證成功！</h1>
        <p>您的認證 token 已安全儲存</p>
        <div class="token-path">${this.tokenPath}</div>
        <p style="color: #666;">
            您現在可以關閉此視窗<br>
            Google Meet MCP Server 將自動完成啟動
        </p>
    </div>
</body>
</html>
          `);
        } catch (error) {
          this.authCompletedSuccessfully = false;
          console.error('Token 儲存失敗：', error.message);
          
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>認證失敗</title>
    <meta charset="utf-8">
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { background: white; padding: 2em; border-radius: 8px; display: inline-block; }
        h1 { color: #d32f2f; }
    </style>
</head>
<body>
    <div class="container">
        <h1>❌ 認證失敗</h1>
        <p>儲存認證資訊時發生錯誤：</p>
        <p style="color: #666;">${error.message}</p>
        <p>請檢查服務器日誌並重新嘗試。</p>
    </div>
</body>
</html>
          `);
        }
      } else {
        // 404 for other routes
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    // Track connections
    server.on('connection', (socket) => {
      this.activeConnections.add(socket);
      socket.on('close', () => {
        this.activeConnections.delete(socket);
      });
    });

    return server;
  }

  /**
   * Find available port in range
   */
  async findAvailablePort(startPort = 3000, endPort = 3010) {
    for (let port = startPort; port <= endPort; port++) {
      try {
        await new Promise((resolve, reject) => {
          const testServer = this.createServer();
          testServer.listen(port, () => {
            this.server = testServer;
            resolve(port);
          });
          testServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              testServer.close(() => reject(err));
            } else {
              reject(err);
            }
          });
        });
        return port;
      } catch (error) {
        if (error.code !== 'EADDRINUSE') {
          throw error;
        }
        // Continue to next port if EADDRINUSE
      }
    }
    throw new Error(`無法在埠口範圍 ${startPort}-${endPort} 找到可用埠口`);
  }

  /**
   * Start authentication server
   */
  async start(openBrowser = true) {
    try {
      // Check if we already have valid tokens
      if (await this.hasValidTokens()) {
        this.authCompletedSuccessfully = true;
        return true;
      }

      // Load credentials and create OAuth client
      const credentials = await this.loadCredentials();
      const port = await this.findAvailablePort();
      
      this.oAuth2Client = this.createOAuth2Client(credentials, `http://localhost:${port}/oauth2callback`);

      // Generate auth URL
      const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly'
      ];
      
      const authUrl = this.oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
      });

      console.error(`🌐 認證服務器已啟動於 http://localhost:${port}`);
      console.error(`🔗 認證 URL: ${authUrl}`);

      if (openBrowser) {
        try {
          await open(authUrl);
          console.error('🚀 瀏覽器已自動開啟，請完成授權流程');
        } catch (error) {
          console.error('⚠️ 無法自動開啟瀏覽器，請手動訪問上方 URL');
        }
      }

      // Wait for authentication to complete
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.authCompletedSuccessfully) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 1000);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!this.authCompletedSuccessfully) {
            console.error('⏰ 認證超時，請重新嘗試');
            resolve(false);
          }
        }, 300000);
      });

    } catch (error) {
      console.error('❌ 啟動認證服務器失敗：', error.message);
      return false;
    }
  }

  /**
   * Stop authentication server
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        // Force close all active connections
        for (const connection of this.activeConnections) {
          connection.destroy();
        }
        this.activeConnections.clear();

        // Close server with timeout
        const timeout = setTimeout(() => {
          console.error('⚠️ 服務器關閉超時，強制退出');
          this.server = null;
          resolve();
        }, 2000);

        this.server.close((err) => {
          clearTimeout(timeout);
          if (err) {
            console.error('⚠️ 關閉服務器時發生錯誤：', err.message);
          }
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
} 