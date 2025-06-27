/**
 * Google Meet API client that interacts with the Google Calendar API
 * to manage Google Meet meetings.
 */

import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

class GoogleMeetAPI {
  /**
   * Initialize the Google Meet API client.
   * @param {string} credentialsPath - Path to the OAuth credentials file
   * @param {string} tokenPath - Path to save/load the token.json file
   */
  constructor(credentialsPath, tokenPath) {
    this.credentialsPath = credentialsPath;
    this.tokenPath = tokenPath;
    this.calendar = null;
  }

  /**
   * Initialize the API client with OAuth2 credentials.
   */
  async initialize() {
    try {
      // Check if credentials file exists
      await fs.access(this.credentialsPath);
    } catch (error) {
      throw new Error(
        `找不到憑證檔案：${this.credentialsPath}\n` +
        `請設定 GOOGLE_OAUTH_CREDENTIALS 環境變數為正確的檔案路徑。\n` +
        `參考：https://github.com/nspady/google-calendar-mcp`
      );
    }

    const credentials = JSON.parse(await fs.readFile(this.credentialsPath, 'utf8'));
    
    // Support both web and installed app credential formats (like google-calendar-mcp)
    let clientConfig;
    if (credentials.web) {
      clientConfig = credentials.web;
    } else if (credentials.installed) {
      clientConfig = credentials.installed;
    } else {
      throw new Error(
        '無效的憑證檔案格式。預期包含 "web" 或 "installed" OAuth 客戶端配置。\n' +
        '請確認您下載的是 Desktop App 類型的 OAuth 憑證。'
      );
    }
    
    const { client_id, client_secret, redirect_uris } = clientConfig;
    
    const oAuth2Client = new google.auth.OAuth2(
      client_id, 
      client_secret, 
      redirect_uris[0]
    );

    try {
      // Check if token exists and use it
      const token = JSON.parse(await fs.readFile(this.tokenPath, 'utf8'));
      oAuth2Client.setCredentials(token);
      
      // Check if token is expired and needs refresh
      if (token.expiry_date && token.expiry_date < Date.now()) {
        // Token is expired, refresh it
        const { credentials: newCredentials } = await oAuth2Client.refreshToken(token.refresh_token);
        await fs.writeFile(this.tokenPath, JSON.stringify(newCredentials));
        oAuth2Client.setCredentials(newCredentials);
      }
    } catch (error) {
      throw new Error(
        `在 ${this.tokenPath} 找不到有效的 token。\n` +
        `請先執行認證設定：npm run auth\n` +
        `錯誤詳情：${error.message}`
      );
    }
    
    // Initialize the calendar API
    this.calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  }
  
  /**
   * List upcoming Google Meet meetings.
   * @param {number} maxResults - Maximum number of results to return
   * @param {string} timeMin - Start time in ISO format
   * @param {string} timeMax - End time in ISO format
   * @returns {Promise<Array>} - List of meetings
   */
  async listMeetings(maxResults = 10, timeMin = null, timeMax = null) {
    // Default timeMin to now if not provided
    if (!timeMin) {
      timeMin = new Date().toISOString();
    }
    
    // Prepare parameters for the API call
    const params = {
      calendarId: 'primary',
      maxResults: maxResults,
      timeMin: timeMin,
      orderBy: 'startTime',
      singleEvents: true,
      conferenceDataVersion: 1
    };
    
    if (timeMax) {
      params.timeMax = timeMax;
    }
    
    try {
      const response = await this.calendar.events.list(params);
      const events = response.data.items || [];
      
      // Filter for events with conferenceData (Google Meet)
      const meetings = [];
      for (const event of events) {
        if (event.conferenceData) {
          const meeting = this._formatMeetingData(event);
          if (meeting) {
            meetings.push(meeting);
          }
        }
      }
      
      return meetings;
    } catch (error) {
      throw new Error(`列出會議時發生錯誤：${error.message}`);
    }
  }
  
  /**
   * Get details of a specific Google Meet meeting.
   * @param {string} meetingId - ID of the meeting to retrieve
   * @returns {Promise<Object>} - Meeting details
   */
  async getMeeting(meetingId) {
    try {
      const response = await this.calendar.events.get({
        calendarId: 'primary',
        eventId: meetingId,
        conferenceDataVersion: 1
      });
      
      const event = response.data;
      
      if (!event.conferenceData) {
        throw new Error(`ID 為 ${meetingId} 的事件沒有 Google Meet 會議資料`);
      }
      
      const meeting = this._formatMeetingData(event);
      if (!meeting) {
        throw new Error(`無法格式化事件 ID ${meetingId} 的會議資料`);
      }
      
      return meeting;
    } catch (error) {
      throw new Error(`獲取會議資訊時發生錯誤：${error.message}`);
    }
  }
  
  /**
   * Create a new Google Meet meeting.
   * @param {string} summary - Title of the meeting
   * @param {string} startTime - Start time in ISO format
   * @param {string} endTime - End time in ISO format
   * @param {string} description - Description for the meeting
   * @param {Array<string>} attendees - List of email addresses for attendees
   * @returns {Promise<Object>} - Created meeting details
   */
  async createMeeting(summary, startTime, endTime, description = "", attendees = []) {
    // Prepare attendees list in the format required by the API
    const formattedAttendees = attendees.map(email => ({ email }));
    
    // Create the event with Google Meet conferencing
    const event = {
      summary: summary,
      description: description,
      start: {
        dateTime: startTime,
        timeZone: 'UTC',
      },
      end: {
        dateTime: endTime,
        timeZone: 'UTC',
      },
      attendees: formattedAttendees,
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        }
      }
    };
    
    try {
      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: 1,
        sendUpdates: 'all', // Send invitations to all attendees
        resource: event
      });
      
      const createdEvent = response.data;
      const meeting = this._formatMeetingData(createdEvent);
      
      if (!meeting) {
        throw new Error('無法格式化創建的會議資料');
      }
      
      return meeting;
    } catch (error) {
      throw new Error(`創建會議時發生錯誤：${error.message}`);
    }
  }
  
  /**
   * Update an existing Google Meet meeting.
   * @param {string} meetingId - ID of the meeting to update
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} - Updated meeting details
   */
  async updateMeeting(meetingId, { summary, description, startTime, endTime, attendees } = {}) {
    try {
      // First get the existing event
      const existingResponse = await this.calendar.events.get({
        calendarId: 'primary',
        eventId: meetingId,
        conferenceDataVersion: 1
      });
      
      const existingEvent = existingResponse.data;
      
      // Prepare the update object
      const updates = {
        ...existingEvent,
      };
      
      if (summary !== undefined) {
        updates.summary = summary;
      }
      
      if (description !== undefined) {
        updates.description = description;
      }
      
      if (startTime !== undefined) {
        updates.start = {
          dateTime: startTime,
          timeZone: 'UTC',
        };
      }
      
      if (endTime !== undefined) {
        updates.end = {
          dateTime: endTime,
          timeZone: 'UTC',
        };
      }
      
      if (attendees !== undefined) {
        updates.attendees = attendees.map(email => ({ email }));
      }
      
      const response = await this.calendar.events.update({
        calendarId: 'primary',
        eventId: meetingId,
        conferenceDataVersion: 1,
        sendUpdates: 'all', // Send updates to all attendees
        resource: updates
      });
      
      const updatedEvent = response.data;
      const meeting = this._formatMeetingData(updatedEvent);
      
      if (!meeting) {
        throw new Error('無法格式化更新的會議資料');
      }
      
      return meeting;
    } catch (error) {
      throw new Error(`更新會議時發生錯誤：${error.message}`);
    }
  }
  
  /**
   * Delete a Google Meet meeting.
   * @param {string} meetingId - ID of the meeting to delete
   * @returns {Promise<void>}
   */
  async deleteMeeting(meetingId) {
    try {
      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId: meetingId,
        sendUpdates: 'all' // Send cancellation to all attendees
      });
    } catch (error) {
      throw new Error(`刪除會議時發生錯誤：${error.message}`);
    }
  }

  /**
   * Check for time conflicts with existing events.
   * @param {string} startTime - Start time in ISO format
   * @param {string} endTime - End time in ISO format
   * @param {Array<string>} calendars - List of calendar IDs to check
   * @returns {Promise<Array>} - List of conflicting events
   */
  async checkTimeConflicts(startTime, endTime, calendars = ['primary']) {
    try {
      const conflicts = [];
      
      for (const calendarId of calendars) {
        const response = await this.calendar.events.list({
          calendarId: calendarId,
          timeMin: startTime,
          timeMax: endTime,
          singleEvents: true,
          orderBy: 'startTime',
          conferenceDataVersion: 1
        });
        
        const events = response.data.items || [];
        
        for (const event of events) {
          // Check if events overlap
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          const checkStart = new Date(startTime);
          const checkEnd = new Date(endTime);
          
          // Events overlap if: start1 < end2 && start2 < end1
          if (eventStart < checkEnd && checkStart < eventEnd) {
            conflicts.push({
              id: event.id,
              summary: event.summary || '無標題',
              start_time: event.start.dateTime || event.start.date,
              end_time: event.end.dateTime || event.end.date,
              calendar: calendarId
            });
          }
        }
      }
      
      return conflicts;
    } catch (error) {
      throw new Error(`檢查時間衝突時發生錯誤：${error.message}`);
    }
  }

  /**
   * Check availability for a specific time range.
   * @param {string} startTime - Start time in ISO format
   * @param {string} endTime - End time in ISO format
   * @param {Array<string>} calendars - List of calendar IDs to check
   * @returns {Promise<Object>} - Availability information
   */
  async checkAvailability(startTime, endTime, calendars = ['primary']) {
    try {
      const conflicts = await this.checkTimeConflicts(startTime, endTime, calendars);
      
      return {
        available: conflicts.length === 0,
        conflicts: conflicts,
        checked_calendars: calendars,
        time_range: {
          start: startTime,
          end: endTime
        }
      };
    } catch (error) {
      throw new Error(`檢查可用性時發生錯誤：${error.message}`);
    }
  }

  /**
   * Get free/busy information for calendars.
   * @param {string} startTime - Start time in ISO format
   * @param {string} endTime - End time in ISO format
   * @param {Array<string>} calendars - List of calendar IDs to check
   * @returns {Promise<Object>} - Free/busy information
   */
  async getFreeBusy(startTime, endTime, calendars = ['primary']) {
    try {
      const response = await this.calendar.freebusy.query({
        resource: {
          timeMin: startTime,
          timeMax: endTime,
          items: calendars.map(id => ({ id }))
        }
      });
      
      const busyTimes = {};
      const freebusyData = response.data.calendars;
      
      for (const [calendarId, data] of Object.entries(freebusyData)) {
        busyTimes[calendarId] = {
          busy: data.busy || [],
          errors: data.errors || []
        };
      }
      
      return {
        time_range: {
          start: startTime,
          end: endTime
        },
        calendars: busyTimes
      };
    } catch (error) {
      throw new Error(`獲取忙碌時間資訊時發生錯誤：${error.message}`);
    }
  }

  /**
   * Format meeting data for consistent output.
   * @param {Object} event - Google Calendar event object
   * @returns {Object|null} - Formatted meeting data
   */
  _formatMeetingData(event) {
    if (!event || !event.conferenceData) {
      return null;
    }
    
    // Extract Google Meet link
    let meetLink = '';
    let phoneInfo = '';
    
    if (event.conferenceData.entryPoints) {
      const videoEntry = event.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video');
      const phoneEntry = event.conferenceData.entryPoints.find(ep => ep.entryPointType === 'phone');
      
      if (videoEntry) {
        meetLink = videoEntry.uri;
      }
      
      if (phoneEntry) {
        phoneInfo = `${phoneEntry.label || ''} ${phoneEntry.uri || ''}`.trim();
      }
    }
    
    // Format attendees
    const attendees = (event.attendees || []).map(attendee => ({
      email: attendee.email,
      status: attendee.responseStatus || 'needsAction',
      optional: attendee.optional || false
    }));
    
    return {
      id: event.id,
      summary: event.summary || '無標題',
      description: event.description || '',
      start_time: event.start.dateTime || event.start.date,
      end_time: event.end.dateTime || event.end.date,
      meet_link: meetLink,
      phone_info: phoneInfo,
      attendees: attendees,
      created: event.created,
      updated: event.updated,
      creator: event.creator,
      organizer: event.organizer,
      status: event.status,
      html_link: event.htmlLink,
      conference_id: event.conferenceData.conferenceId || '',
      location: event.location || ''
    };
  }
}

export default GoogleMeetAPI;
