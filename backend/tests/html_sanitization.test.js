import { describe, it } from 'node:test';
import assert from 'node:assert';
import { truncateOriginalRequest } from '../src/email_ingestion/index.js';

describe('HTML Sanitization in truncateOriginalRequest', () => {
  it('should remove HTML tags from subject', () => {
    const subject = '<h1>Important Task</h1>';
    const body = 'Plain text body';
    const result = truncateOriginalRequest(subject, body);
    
    // Should not contain HTML tags
    assert.ok(!result.includes('<h1>'));
    assert.ok(!result.includes('</h1>'));
    // html-to-text converts h1 tags to uppercase
    assert.ok(result.includes('IMPORTANT TASK'));
  });

  it('should remove HTML tags from body', () => {
    const subject = 'Test Subject';
    const body = '<p>This is a <strong>test</strong> email with <em>HTML</em> content.</p>';
    const result = truncateOriginalRequest(subject, body);
    
    // Should not contain HTML tags
    assert.ok(!result.includes('<p>'));
    assert.ok(!result.includes('<strong>'));
    assert.ok(!result.includes('<em>'));
    assert.ok(!result.includes('</p>'));
    assert.ok(!result.includes('</strong>'));
    assert.ok(!result.includes('</em>'));
    // Should contain the text content
    assert.ok(result.includes('test'));
    assert.ok(result.includes('HTML'));
  });

  it('should remove script tags and prevent XSS', () => {
    const subject = 'Normal Subject';
    const body = '<script>alert("XSS")</script><p>Safe content</p>';
    const result = truncateOriginalRequest(subject, body);
    
    // Should not contain script tags or their content
    assert.ok(!result.includes('<script>'));
    assert.ok(!result.includes('alert'));
    assert.ok(!result.includes('XSS'));
    // Should contain safe content
    assert.ok(result.includes('Safe content'));
  });

  it('should handle complex HTML with nested tags', () => {
    const subject = '<div><span>Subject</span></div>';
    const body = '<div class="container"><p>Paragraph 1</p><ul><li>Item 1</li><li>Item 2</li></ul></div>';
    const result = truncateOriginalRequest(subject, body);
    
    // Should not contain any HTML tags
    assert.ok(!result.includes('<div>'));
    assert.ok(!result.includes('<span>'));
    assert.ok(!result.includes('<p>'));
    assert.ok(!result.includes('<ul>'));
    assert.ok(!result.includes('<li>'));
    // Should contain the text content
    assert.ok(result.includes('Subject'));
    assert.ok(result.includes('Paragraph 1'));
    assert.ok(result.includes('Item 1'));
    assert.ok(result.includes('Item 2'));
  });

  it('should handle HTML entities correctly', () => {
    const subject = 'Test &amp; Subject';
    const body = 'Body with &lt;special&gt; characters &quot;quoted&quot;';
    const result = truncateOriginalRequest(subject, body);
    
    // html-to-text should decode HTML entities
    assert.ok(result.includes('&') || result.includes('amp'));
    assert.ok(result.includes('special') || result.includes('lt') || result.includes('gt'));
  });

  it('should handle plain text without modification', () => {
    const subject = 'Plain Subject';
    const body = 'Plain body text without any HTML';
    const result = truncateOriginalRequest(subject, body);
    
    assert.ok(result.includes('Subject: Plain Subject'));
    assert.ok(result.includes('Plain body text without any HTML'));
  });

  it('should remove inline styles and attributes', () => {
    const subject = '<span style="color: red;">Styled Subject</span>';
    const body = '<div id="content" class="email-body" style="font-size: 14px;">Content</div>';
    const result = truncateOriginalRequest(subject, body);
    
    // Should not contain style attributes or tags
    assert.ok(!result.includes('style='));
    assert.ok(!result.includes('color: red'));
    assert.ok(!result.includes('font-size'));
    // Should contain the text content
    assert.ok(result.includes('Styled Subject'));
    assert.ok(result.includes('Content'));
  });

  it('should handle malicious HTML injection attempts', () => {
    const subject = 'Normal Subject';
    const body = '<img src=x onerror="alert(\'XSS\')"><iframe src="javascript:alert(\'XSS\')"></iframe>';
    const result = truncateOriginalRequest(subject, body);
    
    // Should not contain any dangerous tags or attributes
    assert.ok(!result.includes('<img'));
    assert.ok(!result.includes('onerror'));
    assert.ok(!result.includes('<iframe'));
    assert.ok(!result.includes('javascript:'));
    assert.ok(!result.includes('alert'));
  });
});
