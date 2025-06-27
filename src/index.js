#!/usr/bin/env node

/**
 * Google Meet MCP Server
 * This implements the Model Context Protocol server for Google Meet
 * functionality via the Google Calendar API with automatic authentication.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ErrorCode,
  ListToolsRequestSchema, 
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import GoogleMeetAPI from './GoogleMeetAPI.js';
import { AuthServer } from './AuthServer.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class GoogleMeetMcpServer {
  /**
   * Initialize the Google Meet MCP server
   */
  constructor() {
    this.server = new Server(
      {
        name: 'google-meet-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        }
      }
    );

    // Setup Google Meet API client with environment variable support
    // 優先使用 GOOGLE_OAUTH_CREDENTIALS (與 google-calendar-mcp 一致)
    this.credentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS || 
                          process.env.GOOGLE_MEET_CREDENTIALS_PATH;
    
    if (!this.credentialsPath) {
      console.error("❌ 錯誤：缺少必要的環境變數");
      console.error("請設定 GOOGLE_OAUTH_CREDENTIALS 或 GOOGLE_MEET_CREDENTIALS_PATH");
      console.error("範例：GOOGLE_OAUTH_CREDENTIALS=/path/to/your/credentials.json");
      console.error("參考 google-calendar-mcp 的設定方式：https://github.com/nspady/google-calendar-mcp");
      process.exit(1);
    }

    // Token path can be customized via environment variable
    // 支援 google-calendar-mcp 的 token 路徑環境變數
    this.tokenPath = process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH || 
                    process.env.GOOGLE_MEET_TOKEN_PATH ||
                    this.getDefaultTokenPath();

    this.googleMeet = null;
    this.authServer = null;
    this.isAuthenticated = false;
    
    // Setup request handlers
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = error => console.error(`[MCP Error] ${error}`);
    
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Get default token path based on OS
   */
  getDefaultTokenPath() {
    const os = process.platform;
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    
    if (os === 'win32') {
      return path.join(homeDir, 'AppData', 'Local', 'google-meet-mcp', 'token.json');
    } else if (os === 'darwin') {
      return path.join(homeDir, 'Library', 'Application Support', 'google-meet-mcp', 'token.json');
    } else {
      return path.join(homeDir, '.config', 'google-meet-mcp', 'token.json');
    }
  }

  /**
   * Initialize authentication automatically
   */
  async initializeAuthentication() {
    try {
      // Try to initialize with existing tokens first
      this.googleMeet = new GoogleMeetAPI(this.credentialsPath, this.tokenPath);
      
      try {
        await this.googleMeet.initialize();
        this.isAuthenticated = true;
        console.error('✅ 找到有效的認證 token，無需重新認證');
        return true;
      } catch (error) {
        // No valid tokens, need to authenticate
        console.error('ℹ️ 未找到有效的認證 token，啟動自動認證流程...');
      }

      // Start automatic authentication
      this.authServer = new AuthServer(this.credentialsPath, this.tokenPath);
      const authSuccess = await this.authServer.start(true); // openBrowser = true
      
      if (authSuccess) {
        // Re-initialize with new tokens
        await this.googleMeet.initialize();
        this.isAuthenticated = true;
        console.error('✅ 自動認證成功！');
        return true;
      } else {
        console.error('❌ 自動認證失敗');
        return false;
      }
    } catch (error) {
      console.error('❌ 認證初始化失敗：', error.message);
      return false;
    }
  }

  /**
   * Ensure authentication before tool execution
   */
  async ensureAuthenticated() {
    if (this.isAuthenticated) {
      return;
    }

    // Try to re-authenticate
    const success = await this.initializeAuthentication();
    if (!success) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        '認證失敗。請檢查您的憑證設定並重新啟動服務。'
      );
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.authServer) {
      await this.authServer.stop();
    }
    if (this.server) {
      await this.server.close();
    }
  }

  /**
   * Set up the tool request handlers
   */
  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, this.handleListTools.bind(this));
    this.server.setRequestHandler(CallToolRequestSchema, this.handleCallTool.bind(this));
  }

  /**
   * Handle requests to list available tools
   */
  async handleListTools() {
    return {
      tools: [
        {
          name: 'list_meetings',
          description: '📅 列出即將到來的 Google Meet 會議',
          inputSchema: {
            type: 'object',
            properties: {
              max_results: {
                type: 'number',
                description: '最多返回的結果數量 (預設: 10)'
              },
              time_min: {
                type: 'string',
                description: '開始時間 (ISO 格式，預設: 現在)'
              },
              time_max: {
                type: 'string',
                description: '結束時間 (ISO 格式，可選)'
              }
            },
            required: []
          }
        },
        {
          name: 'get_meeting',
          description: '🔍 獲取特定 Google Meet 會議的詳細資訊',
          inputSchema: {
            type: 'object',
            properties: {
              meeting_id: {
                type: 'string',
                description: '要查詢的會議 ID'
              }
            },
            required: ['meeting_id']
          }
        },
        {
          name: 'create_meeting',
          description: '✨ 創建新的 Google Meet 會議（包含時間衝突檢測）',
          inputSchema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: '會議標題'
              },
              description: {
                type: 'string', 
                description: '會議描述 (可選)'
              },
              start_time: {
                type: 'string',
                description: '開始時間 (ISO 格式)'
              },
              end_time: {
                type: 'string',
                description: '結束時間 (ISO 格式)'
              },
              attendees: {
                type: 'array',
                description: '參與者電子郵件地址列表 (可選)',
                items: {
                  type: 'string'
                }
              },
              check_conflicts: {
                type: 'boolean',
                description: '是否檢查時間衝突 (預設: true)'
              }
            },
            required: ['summary', 'start_time', 'end_time']
          }
        },
        {
          name: 'update_meeting',
          description: '📝 更新現有的 Google Meet 會議',
          inputSchema: {
            type: 'object',
            properties: {
              meeting_id: {
                type: 'string',
                description: '要更新的會議 ID'
              },
              summary: {
                type: 'string', 
                description: '更新的會議標題 (可選)'
              },
              description: {
                type: 'string', 
                description: '更新的會議描述 (可選)'
              },
              start_time: {
                type: 'string', 
                description: '更新的開始時間 (ISO 格式，可選)'
              },
              end_time: {
                type: 'string', 
                description: '更新的結束時間 (ISO 格式，可選)'
              },
              attendees: {
                type: 'array', 
                description: '更新的參與者電子郵件地址列表 (可選)',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['meeting_id']
          }
        },
        {
          name: 'delete_meeting',
          description: '🗑️ 刪除 Google Meet 會議',
          inputSchema: {
            type: 'object',
            properties: {
              meeting_id: {
                type: 'string',
                description: '要刪除的會議 ID'
              }
            },
            required: ['meeting_id']
          }
        },
        {
          name: 'check_availability',
          description: '⏰ 檢查特定時間範圍的可用性',
          inputSchema: {
            type: 'object',
            properties: {
              start_time: {
                type: 'string',
                description: '開始時間 (ISO 格式)'
              },
              end_time: {
                type: 'string',
                description: '結束時間 (ISO 格式)'
              },
              calendars: {
                type: 'array',
                description: '要檢查的日曆列表 (預設: ["primary"])',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['start_time', 'end_time']
          }
        }
      ]
    };
  }

  /**
   * Handle tool execution requests
   */
  async handleCallTool(request) {
    const { name, arguments: args } = request.params;

    try {
      // Ensure authentication before any tool execution
      await this.ensureAuthenticated();

      switch (name) {
        case 'list_meetings':
          return await this.handleListMeetings(args);
        
        case 'get_meeting':
          return await this.handleGetMeeting(args);
        
        case 'create_meeting':
          return await this.handleCreateMeeting(args);
        
        case 'update_meeting':
          return await this.handleUpdateMeeting(args);
        
        case 'delete_meeting':
          return await this.handleDeleteMeeting(args);

        case 'check_availability':
          return await this.handleCheckAvailability(args);

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `未知的工具: ${name}`
          );
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      
      // Provide helpful error messages in Traditional Chinese
      let errorMessage = error.message;
      if (error.message.includes('credentials')) {
        errorMessage += '\n\n💡 解決建議：\n' +
                       '1. 確認 GOOGLE_OAUTH_CREDENTIALS 環境變數設定正確\n' +
                       '2. 檢查憑證檔案路徑是否存在\n' +
                       '3. 重新啟動服務以觸發自動認證';
      } else if (error.message.includes('token')) {
        errorMessage += '\n\n💡 解決建議：\n' +
                       '1. 重新啟動服務以觸發自動認證\n' +
                       '2. 檢查網路連接\n' +
                       '3. 確認 Google Cloud 專案設定正確';
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `執行工具時發生錯誤: ${errorMessage}`
      );
    }
  }

  /**
   * Handle list meetings request
   */
  async handleListMeetings(args) {
    const { max_results = 10, time_min, time_max } = args;
    
    try {
      const meetings = await this.googleMeet.listMeetings(max_results, time_min, time_max);
      
      return {
        content: [
          {
            type: 'text',
            text: `📅 **找到 ${meetings.length} 個即將到來的 Google Meet 會議**\n\n` +
                  meetings.map((meeting, index) => 
                    `**${index + 1}. ${meeting.summary}**\n` +
                    `🕐 時間：${new Date(meeting.start_time).toLocaleString('zh-TW')} - ${new Date(meeting.end_time).toLocaleString('zh-TW')}\n` +
                    `🔗 會議連結：${meeting.meet_link}\n` +
                    `👥 參與者：${meeting.attendees.length} 人\n` +
                    `📋 ID：${meeting.id}\n`
                  ).join('\n') || '目前沒有即將到來的會議。'
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `列出會議時發生錯誤: ${error.message}`);
    }
  }

  /**
   * Handle get meeting request
   */
  async handleGetMeeting(args) {
    const { meeting_id } = args;
    
    if (!meeting_id) {
      throw new McpError(ErrorCode.InvalidParams, '缺少必要參數: meeting_id');
    }
    
    try {
      const meeting = await this.googleMeet.getMeeting(meeting_id);
      
      return {
        content: [
          {
            type: 'text',
            text: `📋 **會議詳細資訊**\n\n` +
                  `**標題：** ${meeting.summary}\n` +
                  `**描述：** ${meeting.description || '無'}\n` +
                  `**開始時間：** ${new Date(meeting.start_time).toLocaleString('zh-TW')}\n` +
                  `**結束時間：** ${new Date(meeting.end_time).toLocaleString('zh-TW')}\n` +
                  `**Google Meet 連結：** ${meeting.meet_link}\n` +
                  `**會議 ID：** ${meeting.id}\n` +
                  `**參與者：**\n${meeting.attendees.map(a => `  • ${a.email} (${a.status})`).join('\n') || '  無參與者'}\n` +
                  `**創建時間：** ${new Date(meeting.created).toLocaleString('zh-TW')}\n` +
                  `**最後更新：** ${new Date(meeting.updated).toLocaleString('zh-TW')}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `獲取會議資訊時發生錯誤: ${error.message}`);
    }
  }

  /**
   * Handle create meeting request with conflict detection
   */
  async handleCreateMeeting(args) {
    const { 
      summary, 
      description = '', 
      start_time, 
      end_time, 
      attendees = [],
      check_conflicts = true 
    } = args;
    
    if (!summary || !start_time || !end_time) {
      throw new McpError(ErrorCode.InvalidParams, '缺少必要參數: summary, start_time, end_time');
    }
    
    try {
      let conflictWarning = '';
      
      // Check for time conflicts if requested
      if (check_conflicts) {
        const conflicts = await this.googleMeet.checkTimeConflicts(start_time, end_time);
        if (conflicts.length > 0) {
          conflictWarning = `\n⚠️ **時間衝突警告：**\n` +
                           conflicts.map(conflict => 
                             `• ${conflict.summary} (${new Date(conflict.start_time).toLocaleString('zh-TW')} - ${new Date(conflict.end_time).toLocaleString('zh-TW')})`
                           ).join('\n') + '\n';
        }
      }
      
      const meeting = await this.googleMeet.createMeeting(summary, start_time, end_time, description, attendees);
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ **會議創建成功！**\n\n` +
                  conflictWarning +
                  `**會議資訊：**\n` +
                  `📋 標題：${meeting.summary}\n` +
                  `📝 描述：${meeting.description || '無'}\n` +
                  `🕐 開始時間：${new Date(meeting.start_time).toLocaleString('zh-TW')}\n` +
                  `🕐 結束時間：${new Date(meeting.end_time).toLocaleString('zh-TW')}\n` +
                  `🔗 **Google Meet 連結：** ${meeting.meet_link}\n` +
                  `📞 電話撥入：${meeting.phone_info || '無'}\n` +
                  `👥 參與者：${meeting.attendees.length} 人\n` +
                  `📧 邀請已發送給：${attendees.join(', ') || '無'}\n` +
                  `🆔 會議 ID：${meeting.id}\n\n` +
                  `💡 **提示：** 您可以複製上方的 Google Meet 連結分享給參與者，或者他們會收到日曆邀請。`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `創建會議時發生錯誤: ${error.message}`);
    }
  }

  /**
   * Handle update meeting request
   */
  async handleUpdateMeeting(args) {
    const { meeting_id, ...updateFields } = args;
    
    if (!meeting_id) {
      throw new McpError(ErrorCode.InvalidParams, '缺少必要參數: meeting_id');
    }
    
    try {
      const meeting = await this.googleMeet.updateMeeting(meeting_id, updateFields);
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ **會議更新成功！**\n\n` +
                  `**更新後的會議資訊：**\n` +
                  `📋 標題：${meeting.summary}\n` +
                  `📝 描述：${meeting.description || '無'}\n` +
                  `🕐 開始時間：${new Date(meeting.start_time).toLocaleString('zh-TW')}\n` +
                  `🕐 結束時間：${new Date(meeting.end_time).toLocaleString('zh-TW')}\n` +
                  `🔗 Google Meet 連結：${meeting.meet_link}\n` +
                  `👥 參與者：${meeting.attendees.length} 人\n` +
                  `🆔 會議 ID：${meeting.id}\n\n` +
                  `📧 **更新通知已發送給所有參與者。**`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `更新會議時發生錯誤: ${error.message}`);
    }
  }

  /**
   * Handle delete meeting request
   */
  async handleDeleteMeeting(args) {
    const { meeting_id } = args;
    
    if (!meeting_id) {
      throw new McpError(ErrorCode.InvalidParams, '缺少必要參數: meeting_id');
    }
    
    try {
      await this.googleMeet.deleteMeeting(meeting_id);
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ **會議刪除成功！**\n\n` +
                  `會議 ID：${meeting_id}\n\n` +
                  `📧 **取消通知已發送給所有參與者。**`
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `刪除會議時發生錯誤: ${error.message}`);
    }
  }

  /**
   * Handle check availability request
   */
  async handleCheckAvailability(args) {
    const { start_time, end_time, calendars = ['primary'] } = args;
    
    if (!start_time || !end_time) {
      throw new McpError(ErrorCode.InvalidParams, '缺少必要參數: start_time, end_time');
    }
    
    try {
      const availability = await this.googleMeet.checkAvailability(start_time, end_time, calendars);
      
      return {
        content: [
          {
            type: 'text',
            text: `⏰ **時間可用性檢查結果**\n\n` +
                  `**檢查時間範圍：**\n` +
                  `🕐 ${new Date(start_time).toLocaleString('zh-TW')} - ${new Date(end_time).toLocaleString('zh-TW')}\n\n` +
                  `**結果：** ${availability.available ? '✅ 時間可用' : '❌ 時間有衝突'}\n\n` +
                  (availability.conflicts.length > 0 ? 
                    `**衝突的會議：**\n` +
                    availability.conflicts.map(conflict => 
                      `• ${conflict.summary} (${new Date(conflict.start_time).toLocaleString('zh-TW')} - ${new Date(conflict.end_time).toLocaleString('zh-TW')})`
                    ).join('\n')
                    : '🎉 在此時間範圍內沒有其他會議！'
                  )
          }
        ]
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `檢查可用性時發生錯誤: ${error.message}`);
    }
  }

  /**
   * Start the server with automatic authentication
   */
  async run() {
    console.error('🚀 Google Meet MCP Server 正在啟動...');
    
    // Initialize authentication automatically
    const authSuccess = await this.initializeAuthentication();
    if (!authSuccess) {
      console.error('❌ 無法完成認證，服務器啟動失敗');
      process.exit(1);
    }
    
    // Start the MCP server
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('✅ Google Meet MCP Server 已成功啟動並完成認證！');
  }
}

// Start the server
const server = new GoogleMeetMcpServer();
server.run().catch(error => {
  console.error('❌ 服務器啟動失敗：', error.message);
  process.exit(1);
});
