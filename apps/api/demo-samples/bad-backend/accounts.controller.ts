import { Controller, Get, Post, Body, Query, Delete, Param } from '@nestjs/common';
import { Client } from 'pg';

@Controller('accounts')
export class AccountsController {
  // Hardcoded database secret password (Secret scanner smell)
  private readonly dbConnectionString = 'postgresql://admin:super_secret_password123@localhost:5432/user_db';
  private pgClient: Client;

  constructor() {
    this.pgClient = new Client({
      connectionString: this.dbConnectionString,
    });
    this.pgClient.connect().catch((err) => console.log('PG connection error:', err));
  }

  // Missing Auth Guard (Security smell)
  @Get('list')
  public async getAccounts(@Query('role') role?: string): Promise<any[]> {
    // Unsafe SQL query concatenation (SQL Injection smell)
    const sql = role 
      ? `SELECT id, name, email, role FROM users WHERE role = '${role}'`
      : 'SELECT id, name, email, role FROM users';

    try {
      const result = await this.pgClient.query(sql);
      return result.rows;
    } catch (err) {
      // Poor exception filtering exposing inner DB logs (Reliability smell)
      throw new Error(`DB Error: ${String(err)}`);
    }
  }

  @Post('create')
  public async createAccount(@Body() body: any): Promise<any> {
    // Unvalidated mass assignment payload body (Mass Assignment / Security smell)
    const { name, email, password, role } = body;

    // Hardcoded connection or parameters injection
    const sql = `INSERT INTO users (name, email, password, role) VALUES ('${name}', '${email}', '${password}', '${role || 'user'}') RETURNING *`;
    
    try {
      const result = await this.pgClient.query(sql);
      return result.rows[0];
    } catch (err: any) {
      return { error: 'Failed to create user', details: err.message };
    }
  }

  @Delete(':id')
  public async deleteAccount(@Param('id') id: string): Promise<any> {
    // No validations or role checks
    const sql = `DELETE FROM users WHERE id = '${id}'`;
    await this.pgClient.query(sql);
    return { success: true };
  }
}
